/**
 * @module api/__tests__/unit/canvasGeneration
 * @description End-to-end contract for the LLM→Excalidraw pipeline
 * (`lib/canvasGeneration`), driven with a scripted OpenAI stream.
 *
 * The module has one public entry point, so everything below goes through
 * `generateCanvasDocument` and asserts on the elements it returns. The OpenAI
 * singleton is replaced at the module boundary — no request is ever made and no
 * key is needed, which is why this file can run without a network or a database.
 *
 * What it pins, in order of how easily each one could regress silently:
 *   - the request contract (prompt, title, JSON mode, token cap) — a model swap
 *     or a dropped field here changes nothing visible until quality drops;
 *   - label-fit sizing and the min/max clamps, including the shape multipliers
 *     that only show up once a label is wide enough to clear `NODE_MIN_WIDTH`;
 *   - layout: the rank-based flow when edges exist and the grid fallback when
 *     they do not, plus the barycentre ordering and column centring;
 *   - the Excalidraw element shape: ids, seeds, versions, `boundElements` and
 *     both halves of every arrow binding;
 *   - the tolerant parser (fences, prose, truncated JSON) and every rejection
 *     path, including which error message the caller actually sees.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OVERLONG_WORD,
  SHARED_LABEL,
  aliasCollision,
  cyclicFlow,
  danglingEdges,
  duplicateIds,
  emptyNodes,
  nestedFlow,
  nonObjectNodes,
  proseOnly,
  proseWrapped,
  shapeComparison,
  simpleFlow,
  truncatedFlow,
  unknownShapes,
} from "../fixtures/canvasGeneration.fixtures";

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

import { AI_PROVIDERS, modelById } from "@nimbus/types";
import { measureLabel } from "@nimbus/utils";
import { generateCanvasDocument } from "../../lib/canvasGeneration";
import type { AiClientHandle } from "../../lib/ai/clientFactory";

/**
 * A test-only handle whose SDK client is the mocked `createMock`. The
 * provider/model id on the handle is what the production code reads.
 */
const makeTestHandle = (modelId = "deepseek-flash"): AiClientHandle => {
  const provider = AI_PROVIDERS.deepseek;
  const model = modelById(provider, modelId);
  if (!model) throw new Error(`unknown model ${modelId}`);
  return {
    providerId: provider.id,
    modelId: model.id,
    source: "free",
    supportsReasoning: model.capabilities.includes("reasoning"),
    client: {
      responses: { create: createMock },
    } as unknown as AiClientHandle["client"],
  };
};

/* ── Element access ───────────────────────────────────────────────────────── */

/** The subset of Excalidraw's element schema this suite reasons about. */
type Element = {
  id: string;
  type: string;
  index: string;
  x: number;
  y: number;
  width: number;
  height: number;
  backgroundColor: string;
  strokeColor: string;
  roundness: unknown;
  boundElements: Array<{ id: string; type: string }> | null;
  containerId?: string;
  text?: string;
  points?: [number, number][];
  elbowed?: boolean;
  startBinding?: {
    elementId: string;
    focus: number;
    gap: number;
    fixedPoint: [number, number];
  };
  endBinding?: {
    elementId: string;
    focus: number;
    gap: number;
    fixedPoint: [number, number];
  };
  seed?: number;
  version?: number;
  versionNonce?: number;
  [key: string]: unknown;
};

/** Fails when any two of the given boxes intersect. */
const expectNoOverlaps = (boxes: Element[]) => {
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      const apart =
        a.x + a.width <= b.x ||
        b.x + b.width <= a.x ||
        a.y + a.height <= b.y ||
        b.y + b.height <= a.y;
      expect(apart, `${a.id} overlaps ${b.id}`).toBe(true);
    }
  }
};

const isShape = (el: Element) => el.type !== "text" && el.type !== "arrow";
const shapesOf = (els: Element[]) => els.filter(isShape);
const textsOf = (els: Element[]) => els.filter((el) => el.type === "text");
const arrowsOf = (els: Element[]) => els.filter((el) => el.type === "arrow");

/** Shapes and their bound text, keyed by the label the model asked for. */
const textByShapeId = (els: Element[]) =>
  new Map(textsOf(els).map((text) => [text.containerId, text]));

/* ── Scripted model stream ────────────────────────────────────────────────── */

type StreamEvent = Record<string, unknown>;

/** Splits text into deltas the way the response stream would. */
const deltasOf = (text: string, chunk = 9): StreamEvent[] => {
  const events: StreamEvent[] = [];
  for (let i = 0; i < text.length; i += chunk) {
    events.push({
      type: "response.output_text.delta",
      delta: text.slice(i, i + chunk),
    });
  }
  return events;
};

const completedEvent = (
  response: Record<string, unknown> = {},
): StreamEvent => ({
  type: "response.completed",
  response: { output: [], ...response },
});

/** A completed response whose `output` carries `text` as an `output_text` part. */
const completedWithText = (text: string): StreamEvent =>
  completedEvent({
    output: [{ type: "message", content: [{ type: "output_text", text }] }],
  });

const respondWith = (events: StreamEvent[]) => {
  createMock.mockResolvedValueOnce(
    (async function* stream() {
      yield* events;
    })(),
  );
};

/**
 * Runs the generator against a scripted stream and returns the result plus the
 * status/reasoning callbacks it made. Rejections propagate, so callers assert
 * them with `rejects`.
 */
async function run(
  events: StreamEvent[],
  prompt = "Draw the sign-up flow",
  label = "Sign-up",
) {
  respondWith(events);
  const reasoning: string[] = [];
  const statuses: string[] = [];
  const result = await generateCanvasDocument({
    prompt,
    label,
    onReasoning: (token) => reasoning.push(token),
    onStatus: (status) => statuses.push(status),
    handle: makeTestHandle(),
  });
  return {
    result,
    reasoning,
    statuses,
    elements: result.canvasData as unknown as Element[],
  };
}

/** The common case: the model streams its JSON as text in several deltas. */
const runText = (text: string, prompt?: string, label?: string) =>
  run([...deltasOf(text), completedEvent()], prompt, label);

const runPayload = (payload: unknown, prompt?: string, label?: string) =>
  runText(JSON.stringify(payload), prompt, label);

/** The request object the module handed to the client. */
const requestArgs = () => createMock.mock.calls[0]![0] as Record<string, any>;

beforeEach(() => {
  createMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/* ── Request contract ─────────────────────────────────────────────────────── */

describe("lib/canvasGeneration", () => {
  describe("the request it sends to the model", () => {
    it("puts the caller's prompt in the input and the title in the instructions", async () => {
      await runPayload(simpleFlow, "Draw a payment retry flow", "Retry policy");

      expect(requestArgs().input).toContain("Draw a payment retry flow");
      expect(requestArgs().instructions).toContain('Title: "Retry policy"');
    });

    it("asks for a streamed json_object response under the canvas token cap", async () => {
      await runPayload(simpleFlow);

      expect(createMock).toHaveBeenCalledTimes(1);
      // The Phase 4 "who paid" headline: the request carries the handle's
      // model id, not an env var. The fixture is `deepseek-flash`; DeepSeek
      // accepts both `effort` and `summary`, so the kwargs carry both.
      expect(requestArgs()).toMatchObject({
        model: "deepseek-flash",
        stream: true,
        max_output_tokens: 16_384,
        reasoning: { effort: "low", summary: "detailed" },
        text: { format: { type: "json_object" } },
      });
    });

    it("constrains the model to the node/edge schema and its soft palette", async () => {
      await runPayload(simpleFlow);

      const { instructions } = requestArgs();
      expect(instructions).toContain('"nodes"');
      expect(instructions).toContain('"edges"');
      expect(instructions).toContain("rectangle, ellipse, or diamond");
      // Every colour the prompt offers must be one the model can actually pick.
      for (const colour of [
        "#e3faf2",
        "#e8f0fe",
        "#fff3bf",
        "#ffe8cc",
        "#f3d9fa",
        "#d3f9d8",
      ]) {
        expect(instructions).toContain(colour);
      }
    });

    it("announces planning before it calls the model", async () => {
      const { statuses } = await runPayload(simpleFlow);

      expect(statuses[0]).toBe("Planning diagram…");
      expect(statuses).toEqual([
        "Planning diagram…",
        "Parsing diagram structure…",
        "Layout — 4 nodes, 3 edges",
        "Drawing shapes and connectors…",
        "Done — 11 canvas elements",
      ]);
    });

    it("relays reasoning deltas and accumulates them into the thinking log", async () => {
      const { result, reasoning } = await run([
        { type: "response.reasoning_summary_text.delta", delta: "Six nodes" },
        { type: "response.reasoning_text.delta", delta: " left to right." },
        ...deltasOf(JSON.stringify(simpleFlow)),
        completedEvent(),
      ]);

      expect(reasoning).toEqual(["Six nodes", " left to right."]);
      expect(result.thinking).toBe("Six nodes left to right.");
    });
  });

  /* ── Sizing ─────────────────────────────────────────────────────────────── */

  describe("sizing nodes from their labels", () => {
    it("holds a short label at the minimum box size", async () => {
      const { elements } = await runPayload({
        nodes: [{ id: "a", label: "A" }],
      });

      const [shape] = shapesOf(elements);
      // 1 char is ~11px of content: both dimensions clamp to the minimums.
      expect(shape).toMatchObject({ width: 180, height: 88 });
      expect(textByShapeId(elements).get(shape!.id)!.text).toBe("A");
    });

    /** The label as Excalidraw will draw it, measured with the shared table. */
    const measured = (text: string) =>
      measureLabel(text, {
        fontSize: 16,
        lineHeight: 1.35,
        maxWidth: Infinity,
      });

    it("hard-splits an unbreakable word and clamps the box to the max width", async () => {
      const { elements } = await runPayload({
        nodes: [{ id: "a", label: OVERLONG_WORD }],
      });

      const [shape] = shapesOf(elements);
      const text = textByShapeId(elements).get(shape!.id)!;
      // The measured line is as wide as the box allows, so the cap bites.
      expect(shape!.width).toBeGreaterThan(340);
      expect(shape!.width).toBeLessThanOrEqual(360);
      expect(text.text!.replaceAll("\n", "")).toBe(OVERLONG_WORD);
      expect(text.text!.split("\n").length).toBeGreaterThanOrEqual(2);
      // Padding plus the measured line height decide the box height.
      expect(shape!.height).toBe(
        Math.max(88, measured(text.text!).height + 40),
      );
      // The wrapped label fits the text element it is bound to.
      expect(measured(text.text!).width).toBeLessThanOrEqual(text.width);
      expect(measured(text.text!).height).toBeLessThanOrEqual(text.height);
    });

    it("wraps on word boundaries and rewrites the label with hard line breaks", async () => {
      const label =
        "one two three four five six seven eight nine ten eleven twelve thirteen fourteen";
      const { elements } = await runPayload({
        nodes: [{ id: "a", label }],
      });

      const [shape] = shapesOf(elements);
      const text = textByShapeId(elements).get(shape!.id)!;
      const lines = text.text!.split("\n");
      expect(lines.length).toBeGreaterThan(1);
      // Wrapping only replaces spaces with line breaks, never drops a word.
      expect(lines.join(" ")).toBe(label);
      // No line is wider than the text element the label is bound to.
      for (const line of lines) {
        expect(measured(line).width).toBeLessThanOrEqual(text.width);
      }
      expect(shape!.width).toBeLessThanOrEqual(360);
      expect(text.width).toBe(shape!.width - 24);
    });

    it("sizes diamonds and ellipses to the text rectangle they can hold", async () => {
      const { elements } = await runPayload(shapeComparison);
      const widths = Object.fromEntries(
        shapesOf(elements).map((shape) => [shape.type, shape.width]),
      );

      // Same 16-char label: a diamond holds half its width in text and an
      // ellipse about 71%, so both need more room than a rectangle.
      expect(widths.rectangle).toBeLessThan(widths.ellipse!);
      expect(widths.ellipse).toBeLessThan(widths.diamond!);
      expect(SHARED_LABEL).toHaveLength(16);
      for (const shape of shapesOf(elements)) {
        const text = textByShapeId(elements).get(shape.id)!;
        expect(measured(text.text!).width).toBeLessThanOrEqual(text.width);
        expect(text.height).toBeLessThanOrEqual(shape.height);
      }
    });

    it("still produces a one-line node for an empty label", async () => {
      const { elements } = await runPayload({
        nodes: [{ id: "a", label: "   " }],
      });

      const [shape] = shapesOf(elements);
      expect(shape).toMatchObject({ width: 180, height: 88 });
      expect(textByShapeId(elements).get(shape!.id)!.text).toBe(" ");
    });
  });

  /* ── Layout ─────────────────────────────────────────────────────────────── */

  describe("layout", () => {
    it("lays edgeless nodes out on a grid sized from the nodes", async () => {
      const { elements } = await runPayload({
        nodes: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
          { id: "c", label: "C" },
          { id: "d", label: "D" },
        ],
      });

      // ceil(sqrt(4)) = 2 columns of 180px boxes, 80px apart, 70px between rows.
      expect(shapesOf(elements).map((shape) => [shape.x, shape.y])).toEqual([
        [80, 80],
        [340, 80],
        [80, 238],
        [340, 238],
      ]);
    });

    it("uses ceil(sqrt(n)) columns so a fifth node starts a new row", async () => {
      const { elements } = await runPayload({
        nodes: ["a", "b", "c", "d", "e"].map((id) => ({ id, label: id })),
      });

      expect(shapesOf(elements).map((shape) => shape.x)).toEqual([
        80, 340, 600, 80, 340,
      ]);
    });

    it("keeps wide and tall edgeless nodes from colliding", async () => {
      const { elements } = await runPayload({
        nodes: [
          { id: "a", label: OVERLONG_WORD },
          { id: "b", label: "B" },
          { id: "c", label: "word ".repeat(40), shape: "diamond" },
          { id: "d", label: "D" },
        ],
      });

      expectNoOverlaps(shapesOf(elements));
    });

    it("ranks a chain into left-to-right columns on one line", async () => {
      const { elements, statuses } = await runPayload(simpleFlow);

      const shapes = shapesOf(elements);
      expect(shapes[0]!.x).toBe(80);
      for (let i = 1; i < shapes.length; i++) {
        expect(shapes[i]!.x).toBeGreaterThan(
          shapes[i - 1]!.x + shapes[i - 1]!.width,
        );
      }
      // Every node is centred on the same line.
      expect(
        new Set(shapes.map((shape) => shape.y + shape.height / 2)).size,
      ).toBe(1);
      expect(statuses).toContain("Layout — 4 nodes, 3 edges");
    });

    it("stacks a fan-out in one column beside its source", async () => {
      const { elements } = await runPayload({
        nodes: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
          { id: "c", label: "C" },
        ],
        edges: [
          { from: "a", to: "b" },
          { from: "a", to: "c" },
        ],
      });

      const [source, upper, lower] = shapesOf(elements);
      // Both targets share the second column, one above the other...
      expect(upper!.x).toBe(lower!.x);
      expect(upper!.x).toBeGreaterThan(source!.x + source!.width);
      expect(lower!.y).toBeGreaterThanOrEqual(upper!.y + upper!.height + 56);
      // ...and the source sits within the span of that stack.
      const centre = source!.y + source!.height / 2;
      expect(centre).toBeGreaterThanOrEqual(upper!.y);
      expect(centre).toBeLessThanOrEqual(lower!.y + lower!.height);
    });

    it("keeps a column of three or more nodes apart", async () => {
      const { elements } = await runPayload({
        nodes: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
          { id: "c", label: "C" },
          { id: "d", label: "D" },
        ],
        edges: [
          { from: "a", to: "b" },
          { from: "a", to: "c" },
          { from: "a", to: "d" },
        ],
      });

      const [source, ...targets] = shapesOf(elements);
      expect(new Set(targets.map((shape) => shape.x)).size).toBe(1);
      for (let i = 1; i < targets.length; i++) {
        expect(targets[i]!.y).toBeGreaterThanOrEqual(
          targets[i - 1]!.y + targets[i - 1]!.height + 56,
        );
      }
      expect(source!.y + source!.height / 2).toBeCloseTo(
        targets[1]!.y + targets[1]!.height / 2,
        0,
      );
    });

    it("orders the first column by the order the model listed the nodes", async () => {
      const { elements } = await runPayload({
        nodes: [
          { id: "first", label: "First", x: 900, y: 500 },
          { id: "second", label: "Second", x: 10, y: 20 },
          { id: "sink", label: "Sink" },
        ],
        edges: [
          { from: "first", to: "sink" },
          { from: "second", to: "sink" },
        ],
      });

      const texts = textByShapeId(elements);
      const firstColumn = shapesOf(elements)
        .filter((shape) => shape.x === 80)
        .sort((a, b) => a.y - b.y)
        .map((shape) => texts.get(shape.id)!.text);
      // Coordinate hints are ignored; list order decides, so layouts are stable.
      expect(firstColumn).toEqual(["First", "Second"]);
    });

    it("lays out a nine-node, nine-edge flow with every edge routed", async () => {
      const { elements } = await runPayload(nestedFlow);

      const shapes = shapesOf(elements);
      expect(shapes).toHaveLength(9);
      expect(arrowsOf(elements)).toHaveLength(9);
      const columns = [...new Set(shapes.map((shape) => shape.x))].sort(
        (a, b) => a - b,
      );
      expect(columns.length).toBeGreaterThanOrEqual(7);
      expect(columns[0]).toBe(80);
      expectNoOverlaps(shapes);
      for (const arrow of arrowsOf(elements)) {
        expect(arrow.points!.length).toBeGreaterThanOrEqual(2);
      }
      // Branching edges bend around boxes rather than cutting across them.
      expect(arrowsOf(elements).some((a) => a.points!.length > 2)).toBe(true);
    });
  });

  /* ── Elements ───────────────────────────────────────────────────────────── */

  describe("the Excalidraw elements it emits", () => {
    it("emits a shape and a bound text element per node, plus one arrow per edge", async () => {
      const { elements } = await runPayload(simpleFlow);

      expect(shapesOf(elements)).toHaveLength(4);
      expect(textsOf(elements)).toHaveLength(4);
      expect(arrowsOf(elements)).toHaveLength(3);
      expect(new Set(elements.map((el) => el.id)).size).toBe(elements.length);
      // Fractional-index keys must be distinct or Excalidraw's reconciler reorders.
      expect(elements.map((el) => el.index)).toEqual(
        elements.map((_, index) => `a${index}`),
      );
    });

    it("gives every element the fields Excalidraw requires", async () => {
      const { elements } = await runPayload(simpleFlow);

      for (const el of elements) {
        expect(el).toMatchObject({
          angle: 0,
          fillStyle: "solid",
          strokeWidth: 1,
          strokeStyle: "solid",
          roughness: 1,
          opacity: 100,
          groupIds: [],
          frameId: null,
          version: 1,
          isDeleted: false,
          link: null,
          locked: false,
        });
        // Shape only. The exact id length is pinned separately, so that the
        // generator's rare short ids cannot turn this field-shape check red.
        expect(typeof el.id).toBe("string");
        expect(el.id.length).toBeGreaterThan(0);
        expect(Number.isInteger(el.seed)).toBe(true);
        expect(Number.isInteger(el.versionNonce)).toBe(true);
        expect(typeof el.updated).toBe("number");
        expect(Number.isFinite(el.x)).toBe(true);
        expect(Number.isFinite(el.y)).toBe(true);
        // Only rectangles are rounded; text and arrows must carry null.
        expect(el.roundness).toEqual(
          el.type === "rectangle" ? { type: 3 } : null,
        );
      }
    });

    it("gives every element an id exactly 10 characters long", async () => {
      // `toString(36)` emits as many digits as the value needs, so the raw slice
      // was short roughly 0.7% of the time. The generator pads, and stubbing the
      // draw makes a value that would have been short reproducible instead of
      // leaving a test that failed about one run in three.
      vi.spyOn(Math, "random").mockReturnValue(0.5);

      const { elements } = await runPayload(simpleFlow);

      expect(elements.length).toBeGreaterThan(0);
      for (const el of elements) {
        expect(el.id).toMatch(/^[a-z0-9]{10}$/);
      }
    });

    it("binds each label to its container, centred in the text area", async () => {
      const { elements } = await runPayload(shapeComparison);
      const texts = textByShapeId(elements);

      for (const shape of shapesOf(elements)) {
        const text = texts.get(shape.id)!;
        expect(text).toBeDefined();
        expect(shape.boundElements).toEqual([{ id: text.id, type: "text" }]);
        expect(text).toMatchObject({
          containerId: shape.id,
          backgroundColor: "transparent",
          fontSize: 16,
          fontFamily: 1,
          textAlign: "center",
          verticalAlign: "middle",
          autoResize: false,
        });
        expect(text.x + text.width / 2).toBeCloseTo(shape.x + shape.width / 2);
        expect(text.y + text.height / 2).toBeCloseTo(
          shape.y + shape.height / 2,
        );
        expect(text.width).toBeLessThanOrEqual(shape.width);
        expect(text.height).toBeLessThanOrEqual(shape.height);
        expect(text.originalText).toBe(text.text);
      }
      // A rectangle's text area is the box inset by 12px on each side.
      const rect = shapesOf(elements).find((s) => s.type === "rectangle")!;
      expect(texts.get(rect.id)!.width).toBe(rect.width - 24);
    });

    it("carries the shape's colours onto its label and arrow defaults", async () => {
      const { elements } = await runPayload({
        nodes: [
          {
            id: "a",
            label: "A",
            backgroundColor: "#ff0000",
            strokeColor: "#123456",
          },
          { id: "b", label: "B" },
        ],
        edges: [{ from: "a", to: "b" }],
      });

      const [first, second] = shapesOf(elements);
      expect(first).toMatchObject({
        backgroundColor: "#ff0000",
        strokeColor: "#123456",
      });
      expect(textByShapeId(elements).get(first!.id)!.strokeColor).toBe(
        "#123456",
      );
      // Palette rotation is by array index, so the second node gets palette[1].
      expect(second).toMatchObject({
        backgroundColor: "#e8f0fe",
        strokeColor: "#1e1e1e",
      });
      expect(arrowsOf(elements)[0]!.strokeColor).toBe("#1e1e1e");
    });

    it("registers every arrow on both of the shapes it connects", async () => {
      const { elements } = await runPayload({
        nodes: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        edges: [{ from: "a", to: "b" }],
      });

      const [from, to] = shapesOf(elements);
      const [arrow] = arrowsOf(elements);
      expect(from!.boundElements).toEqual([
        { id: textByShapeId(elements).get(from!.id)!.id, type: "text" },
        { id: arrow!.id, type: "arrow" },
      ]);
      expect(to!.boundElements).toContainEqual({
        id: arrow!.id,
        type: "arrow",
      });
      expect(arrow).toMatchObject({
        elbowed: true,
        endArrowhead: "arrow",
        startArrowhead: null,
        startBinding: { elementId: from!.id, focus: 0, gap: 8 },
        endBinding: { elementId: to!.id, focus: 0, gap: 8 },
      });
    });

    it("keeps arrow points local to the arrow's own origin", async () => {
      const { elements } = await runPayload(simpleFlow);
      const texts = textByShapeId(elements);

      for (const arrow of arrowsOf(elements)) {
        const xs = arrow.points!.map((point) => point[0]);
        const ys = arrow.points!.map((point) => point[1]);
        expect(arrow.points![0]).toEqual([0, 0]);
        expect(arrow.width).toBe(
          Math.max(1, Math.max(...xs) - Math.min(...xs)),
        );
        expect(arrow.height).toBe(
          Math.max(1, Math.max(...ys) - Math.min(...ys)),
        );
        // The arrow starts on the source's edge, not at its centre.
        const from = shapesOf(elements).find(
          (shape) => shape.id === arrow.startBinding!.elementId,
        )!;
        expect(arrow.x).toBeGreaterThanOrEqual(from.x);
        expect(arrow.x).toBeLessThanOrEqual(from.x + from.width);
        expect(texts.get(from.id)!.text).toBeTruthy();
      }
    });

    it("spreads parallel arrows across the source edge instead of stacking them", async () => {
      const { elements } = await runPayload({
        nodes: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
          { id: "c", label: "C" },
        ],
        edges: [
          { from: "a", to: "b" },
          { from: "a", to: "c" },
        ],
      });

      const fixedPoints = arrowsOf(elements).map(
        (arrow) => arrow.startBinding!.fixedPoint,
      );
      // Both leave by the right edge, at different heights along it.
      expect(fixedPoints.map(([x]) => x)).toEqual([1, 1]);
      expect(fixedPoints[0]![1]).not.toBe(fixedPoints[1]![1]);
      const ys = arrowsOf(elements).map((arrow) => arrow.y);
      expect(ys[0]).not.toBe(ys[1]);
    });

    it("routes arrows orthogonally and never through a third box", async () => {
      const { elements } = await runPayload({
        nodes: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
          { id: "c", label: "C" },
          { id: "d", label: "D" },
        ],
        edges: [
          { from: "a", to: "b" },
          { from: "a", to: "c" },
          { from: "a", to: "d" },
          { from: "b", to: "d" },
        ],
      });

      const shapes = new Map(shapesOf(elements).map((s) => [s.id, s]));
      for (const arrow of arrowsOf(elements)) {
        const abs = arrow.points!.map(
          ([px, py]) => [arrow.x + px, arrow.y + py] as const,
        );
        for (let k = 0; k + 1 < abs.length; k++) {
          const [p, q] = [abs[k]!, abs[k + 1]!];
          expect(
            Math.abs(p[0] - q[0]) < 0.5 || Math.abs(p[1] - q[1]) < 0.5,
          ).toBe(true);
          for (const [id, box] of shapes) {
            if (
              id === arrow.startBinding!.elementId ||
              id === arrow.endBinding!.elementId
            ) {
              continue;
            }
            const inside =
              Math.max(p[0], q[0]) > box.x + 1 &&
              Math.min(p[0], q[0]) < box.x + box.width - 1 &&
              Math.max(p[1], q[1]) > box.y + 1 &&
              Math.min(p[1], q[1]) < box.y + box.height - 1;
            expect(inside).toBe(false);
          }
        }
        // Both ends are bound to where the route meets the box.
        for (const [binding, [px, py]] of [
          [arrow.startBinding!, abs[0]!],
          [arrow.endBinding!, abs[abs.length - 1]!],
        ] as const) {
          const box = shapes.get(binding.elementId)!;
          expect(box.x + binding.fixedPoint[0] * box.width).toBeCloseTo(px, 3);
          expect(box.y + binding.fixedPoint[1] * box.height).toBeCloseTo(py, 3);
        }
      }
    });

    it("drops edges that are duplicated, self-referencing or dangling", async () => {
      const { elements, statuses } = await runPayload(danglingEdges);

      expect(shapesOf(elements)).toHaveLength(2);
      expect(arrowsOf(elements)).toHaveLength(1);
      expect(statuses).toContain("Layout — 2 nodes, 1 edges");
    });

    it("falls back to rectangle, generated ids and generated labels", async () => {
      const { elements, statuses } = await runPayload(unknownShapes);

      expect(shapesOf(elements).map((shape) => shape.type)).toEqual([
        "rectangle",
        "rectangle",
        "diamond",
        "rectangle",
      ]);
      const labels = shapesOf(elements).map(
        (shape) => textByShapeId(elements).get(shape.id)!.text,
      );
      expect(labels).toEqual([
        "Unsupported shape",
        "Numeric shape",
        "Missing id",
        "Step 4",
      ]);
      // Palette rotation still applies when the model sends a non-string colour.
      expect(shapesOf(elements)[3]!.backgroundColor).toBe("#ffe8cc");
      // The id is trimmed, and the two nameless nodes get positional ids.
      expect(statuses).toContain("Layout — 4 nodes, 0 edges");
    });
  });

  /* ── Malformed output ───────────────────────────────────────────────────── */

  describe("malformed model output", () => {
    it("salvages a diagram cut off mid-token by closing its brackets", async () => {
      const { elements, statuses } = await runText(truncatedFlow);

      // The unterminated label is trimmed, then the node it belonged to is
      // dropped as a dangling object — only complete nodes survive.
      expect(shapesOf(elements)).toHaveLength(2);
      expect(arrowsOf(elements)).toHaveLength(0);
      expect(statuses).toContain("Layout — 2 nodes, 0 edges");
      const labels = shapesOf(elements).map(
        (shape) => textByShapeId(elements).get(shape.id)!.text,
      );
      expect(labels).toEqual(["Ingest", "Normalise"]);
    });

    it("reads the diagram out of a markdown fence and surrounding prose", async () => {
      const { elements } = await runText(proseWrapped);

      expect(shapesOf(elements)).toHaveLength(4);
      expect(arrowsOf(elements)).toHaveLength(3);
    });

    it("rejects an answer that contains no JSON object at all", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await expect(runText(proseOnly)).rejects.toThrow(
        /Canvas model returned invalid JSON/,
      );
      // The preview is the only breadcrumb left for whoever debugs this.
      expect(errorSpy).toHaveBeenCalledWith(
        "[canvas] invalid JSON preview:",
        expect.stringContaining("ambiguous"),
      );
    });

    it("rejects a nodes list that is empty or full of non-objects", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});

      await expect(runPayload(emptyNodes)).rejects.toThrow(/invalid JSON/);
      await expect(runPayload(nonObjectNodes)).rejects.toThrow(/invalid JSON/);
    });

    it("rejects a JSON document that is not a diagram object", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});

      await expect(runText("[1,2,3]")).rejects.toThrow(/invalid JSON/);
      await expect(runText("null")).rejects.toThrow(/invalid JSON/);
      await expect(runText('{"nodes":"four"}')).rejects.toThrow(/invalid JSON/);
    });

    it("names the validation failure instead of reporting valid JSON as unparseable", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});

      // `{"nodes":[]}` parses fine; it is rejected by the node validator. The
      // thrown message carries the validator's reason, because reporting a
      // valid payload as "invalid JSON" sends debugging in the wrong direction.
      await expect(runPayload(emptyNodes)).rejects.toThrow(/at least one node/);
    });

    it("recovers a diagram the model left in its reasoning channel", async () => {
      const { result, elements } = await run([
        {
          type: "response.reasoning_text.delta",
          delta: JSON.stringify(simpleFlow),
        },
        { type: "response.output_text.delta", delta: "I cannot produce that." },
        completedEvent(),
      ]);

      expect(shapesOf(elements)).toHaveLength(4);
      expect(result.thinking).toContain('"nodes"');
    });
  });

  /* ── Stream reconciliation ──────────────────────────────────────────────── */

  describe("reconciling the stream against the final response", () => {
    it("adopts the completed text when it is longer than the deltas", async () => {
      const full = JSON.stringify(simpleFlow);
      const { elements } = await run([
        { type: "response.output_text.delta", delta: full.slice(0, 40) },
        { type: "response.output_text.done", text: full },
        completedEvent(),
      ]);

      expect(shapesOf(elements)).toHaveLength(4);
    });

    it("keeps the accumulated deltas when the done event is shorter", async () => {
      const full = JSON.stringify(simpleFlow);
      const { elements } = await run([
        ...deltasOf(full),
        { type: "response.output_text.done", text: "{}" },
        completedEvent(),
      ]);

      // A naive overwrite would leave "{}" and the run would fail with no nodes.
      expect(shapesOf(elements)).toHaveLength(4);
    });

    it("keeps the accumulated deltas when the completed output is shorter", async () => {
      const { elements } = await run([
        ...deltasOf(JSON.stringify(simpleFlow)),
        completedWithText("{}"),
      ]);

      expect(shapesOf(elements)).toHaveLength(4);
    });

    it("falls back to the completed output when no deltas arrived", async () => {
      const { elements, statuses } = await run([
        completedWithText(JSON.stringify(simpleFlow)),
      ]);

      expect(shapesOf(elements)).toHaveLength(4);
      expect(statuses.at(-1)).toBe("Done — 11 canvas elements");
    });

    it("prefers output_parsed when the fast path supplies it", async () => {
      const { elements, statuses } = await run([
        completedEvent({ output_parsed: simpleFlow }),
      ]);

      expect(shapesOf(elements)).toHaveLength(4);
      expect(arrowsOf(elements)).toHaveLength(3);
      // planning + parsing + layout + drawing + done
      expect(statuses).toHaveLength(5);
    });

    it("falls back to streamed text when the fast path carries a bad parsed payload", async () => {
      // `nodes: []` satisfies the fast path's `Array.isArray` guard, then the
      // validator rejects it. The fast path is an optimisation, so it must not
      // be the only route to an answer: the good diagram in the streamed text
      // is used instead of being discarded.
      const { elements } = await run([
        ...deltasOf(JSON.stringify(simpleFlow)),
        completedEvent({ output_parsed: emptyNodes }),
      ]);

      expect(shapesOf(elements)).toHaveLength(4);
    });
  });

  /* ── Failure modes ──────────────────────────────────────────────────────── */

  describe("per-provider reasoning shaping (Phase 0 finding)", () => {
    /**
     * Groq accepts `reasoning.effort` and rejects `reasoning.summary` with
     * `400 Field 'reasoning.summary' is not supported`. The canvas pipeline
     * sends both unconditionally, so a Groq handle must elide `summary`
     * rather than crash. The model spec on the handle carries the
     * `reasoningSummary` capability bit, and the factory omits the field
     * when the bit is absent.
     */
    it("omits `reasoning.summary` when the handle lacks `reasoningSummary`", async () => {
      // Construct a Groq handle whose gpt-oss model has reasoning but not
      // reasoningSummary. `requestArgs` reads the request the module sent.
      const provider = AI_PROVIDERS.groq;
      const model = modelById(provider, "openai/gpt-oss-120b")!;
      const groqHandle: AiClientHandle = {
        providerId: provider.id,
        modelId: model.id,
        source: "byok",
        supportsReasoning: model.capabilities.includes("reasoning"),
        client: {
          responses: { create: createMock },
        } as unknown as AiClientHandle["client"],
      };

      respondWith([completedEvent()]);
      await expect(
        generateCanvasDocument({
          prompt: "p",
          label: "L",
          handle: groqHandle,
        }),
      ).rejects.toThrow(); // empty stream → throws, but the request shape is what we pin

      const req = requestArgs() as Record<string, unknown>;
      expect(req.reasoning).toEqual({ effort: "low" });
      expect(req.reasoning).not.toHaveProperty("summary");
    });

    it("includes `reasoning.summary` when the handle has `reasoningSummary`", async () => {
      // The default DeepSeek handle used in `run` is the positive case
      // (verified by the request-contract test). This is the explicit
      // counterpart.
      respondWith([completedEvent()]);
      await expect(
        generateCanvasDocument({
          prompt: "p",
          label: "L",
          handle: makeTestHandle(),
        }),
      ).rejects.toThrow();

      const req = requestArgs() as Record<string, unknown>;
      expect(req.reasoning).toEqual({
        effort: "low",
        summary: "detailed",
      });
    });

    it("uses the handle's model id, not an env var", async () => {
      // The "who paid" headline for canvas: a BYOK handle on a non-default
      // model must drive the request. A regression that re-introduced an
      // env-var read would silently revert this.
      const openaiHandle: AiClientHandle = {
        providerId: AI_PROVIDERS.openai.id,
        modelId: "gpt-5-nano",
        source: "byok",
        supportsReasoning: true,
        client: {
          responses: { create: createMock },
        } as unknown as AiClientHandle["client"],
      };

      respondWith([completedEvent()]);
      await expect(
        generateCanvasDocument({
          prompt: "p",
          label: "L",
          handle: openaiHandle,
        }),
      ).rejects.toThrow();

      expect(requestArgs().model).toBe("gpt-5-nano");
    });
  });

  describe("failure modes", () => {
    it("does not require an env var to construct — env-var reads are gone", async () => {
      // Phase 4 removed the module-level singleton. The function now reads
      // the API key from the handle, so the API key env var is never
      // touched. The single source of truth is the caller-built handle;
      // this test pins that contract by passing an empty stream through it.
      await expect(run([completedEvent()])).rejects.toThrow(
        /empty canvas response/i,
      );
    });

    it("rejects an empty response instead of returning an empty canvas", async () => {
      // Phase 4 changed the message from "OpenAI returned an empty canvas
      // response" to the provider-neutral "AI provider returned an empty
      // canvas response" — the function no longer assumes OpenAI specifically.
      await expect(run([completedEvent()])).rejects.toThrow(
        "AI provider returned an empty canvas response",
      );
    });

    it("propagates a transport failure from the client", async () => {
      createMock.mockRejectedValueOnce(new Error("socket hang up"));

      await expect(
        generateCanvasDocument({
          prompt: "prompt",
          label: "label",
          handle: makeTestHandle(),
        }),
      ).rejects.toThrow("socket hang up");
    });
  });

  /* ── Repeated ids and unusable coordinate hints ─────────────────────────── */

  describe("repeated ids and unusable coordinate hints", () => {
    it("suffixes a repeated id and lays out every node that claimed it", async () => {
      const { elements } = await runPayload(duplicateIds);

      // The two `task` nodes share a logical rank, so both belong in the same
      // column — neither escapes the layout pass, and each gets its own arrow.
      const [entry, first, second] = shapesOf(elements);
      expect(entry!.x).toBe(80);
      expect(first!.x).toBe(second!.x);
      expect(first!.x).toBeGreaterThan(entry!.x + entry!.width);
      expect(first!.boundElements!.map((b) => b.type)).toEqual([
        "text",
        "arrow",
      ]);
      expect(second!.boundElements!.map((b) => b.type)).toEqual([
        "text",
        "arrow",
      ]);
      expect(arrowsOf(elements)).toHaveLength(2);
    });

    it("keeps a literal id that collides with a generated alias", async () => {
      const { elements } = await runPayload(aliasCollision);

      // The fourth node duplicates `task` while the third is genuinely named
      // `task_2`, so the duplicate has to skip that name rather than take it.
      expect(shapesOf(elements)).toHaveLength(4);
      expect(textsOf(elements).map((text) => text.text)).toEqual([
        "Entry",
        "First task",
        "Named task_2",
        "Second task",
      ]);
      // Two rank columns: the duplicate was laid out rather than left at its
      // parse-time hint, which would show up as a third distinct x.
      expect(new Set(shapesOf(elements).map((shape) => shape.x)).size).toBe(2);
    });

    it("treats a null coordinate hint as no hint rather than as y = 0", async () => {
      const { elements } = await runPayload({
        nodes: [
          { id: "alpha", label: "Alpha", y: 40 },
          { id: "beta", label: "Beta", y: null },
          { id: "sink", label: "Sink" },
        ],
        edges: [
          { from: "alpha", to: "sink" },
          { from: "beta", to: "sink" },
        ],
      });

      const texts = textByShapeId(elements);
      const firstColumn = shapesOf(elements)
        .filter((shape) => shape.x === 80)
        .sort((a, b) => a.y - b.y)
        .map((shape) => texts.get(shape.id)!.text);

      // `Number(null)` is 0 and 0 is finite, so reading the hint as 0 would sort
      // `beta` ahead of `alpha`'s real hint of 40. The fallback is the
      // index-derived default (y = 80), which leaves `alpha` in front.
      expect(firstColumn).toEqual(["Alpha", "Beta"]);
    });

    it("starts a cyclic flow at the canvas origin", async () => {
      const { elements } = await runPayload(cyclicFlow);

      // A cycle never reaches a fixed point, so its ranks stay arbitrary and
      // sparse. Compressing the used ranks onto consecutive columns means no
      // column is allocated for an empty rank, so the drawing starts at the
      // origin instead of ~2.5k px to the right.
      expect(Math.min(...shapesOf(elements).map((shape) => shape.x))).toBe(80);
    });
  });
});
