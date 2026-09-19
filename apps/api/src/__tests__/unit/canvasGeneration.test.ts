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

// `lib/canvasGeneration` imports the client as `./openaiClient`; vitest keys
// module mocks by resolved id, so this relative path from the test file hits
// the same module. Without it the import would construct a real OpenAI client.
vi.mock("../../lib/openaiClient", () => ({
  default: { responses: { create: createMock } },
}));

import { generateCanvasDocument } from "../../lib/canvasGeneration";

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
): StreamEvent => ({ type: "response.completed", response: { output: [], ...response } });

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
  const result = await generateCanvasDocument(
    prompt,
    label,
    (token) => reasoning.push(token),
    (status) => statuses.push(status),
  );
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
      expect(requestArgs()).toMatchObject({
        model: process.env.OPENAI_MODEL,
        stream: true,
        max_output_tokens: 8192,
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

    it("hard-splits an unbreakable word and clamps the box to the max width", async () => {
      const { elements } = await runPayload({
        nodes: [{ id: "a", label: OVERLONG_WORD }],
      });

      const [shape] = shapesOf(elements);
      // 29 chars per line * 10.88px + 44px padding = 360.5, so the width cap bites.
      expect(shape!.width).toBe(360);
      // 3 lines (29/29/2) * 21.6px + 40px padding.
      expect(shape!.height).toBe(105);
      expect(textByShapeId(elements).get(shape!.id)!.text).toBe(
        `${"x".repeat(29)}\n${"x".repeat(29)}\nxx`,
      );
    });

    it("wraps on word boundaries and rewrites the label with hard line breaks", async () => {
      const { elements } = await runPayload({
        nodes: [{ id: "a", label: "one two three four five six seven" }],
      });

      const [shape] = shapesOf(elements);
      const text = textByShapeId(elements).get(shape!.id)!;
      expect(text.text).toBe("one two three four five six\nseven");
      // Nothing after the break is merged back: 27 chars + padding.
      expect(shape!.width).toBe(338);
      // Two lines would be 84px, so the height floor is what decides this box.
      expect(shape!.height).toBe(88);
      expect(text.width).toBe(338 - 24);
    });

    it("gives diamonds and ellipses extra room for their clipped corners", async () => {
      const { elements } = await runPayload(shapeComparison);
      const widths = Object.fromEntries(
        shapesOf(elements).map((shape) => [shape.type, shape.width]),
      );

      // Same 16-char label, so only the shape multiplier differs.
      expect(widths).toEqual({ rectangle: 219, ellipse: 237, diamond: 263 });
      // Height stays at the floor for this label, so the multiplier is invisible there.
      expect(shapesOf(elements).map((shape) => shape.height)).toEqual([88, 88, 88]);
      expect(SHARED_LABEL).toHaveLength(16);
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
    it("falls back to a row-wrapped grid when there are no edges", async () => {
      const { elements } = await runPayload({
        nodes: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
          { id: "c", label: "C" },
          { id: "d", label: "D" },
        ],
      });

      // ceil(sqrt(4)) = 2 columns of 180px boxes, 220px apart, 140px between rows.
      expect(shapesOf(elements).map((shape) => [shape.x, shape.y])).toEqual([
        [80, 80],
        [480, 80],
        [80, 308],
        [480, 308],
      ]);
    });

    it("uses ceil(sqrt(n)) columns so a fifth node starts a new row", async () => {
      const { elements } = await runPayload({
        nodes: ["a", "b", "c", "d", "e"].map((id) => ({ id, label: id })),
      });

      expect(shapesOf(elements).map((shape) => shape.x)).toEqual([
        80, 480, 880, 80, 480,
      ]);
    });

    it("ranks a chain into left-to-right columns", async () => {
      const { elements, statuses } = await runPayload(simpleFlow);

      const xs = shapesOf(elements).map((shape) => shape.x);
      expect(xs).toEqual([80, 480, 880, 1280]);
      // Every column is centred against the tallest one; a 1-node column equals
      // itself, so the chain sits on the start line.
      expect(shapesOf(elements).map((shape) => shape.y)).toEqual([80, 80, 80, 80]);
      expect(statuses).toContain("Layout — 4 nodes, 3 edges");
    });

    it("stacks a fan-out in one column and centres the taller column", async () => {
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

      const placed = Object.fromEntries(
        shapesOf(elements).map((shape, index) => [index, shape]),
      );
      // Both targets share the second column...
      expect([placed[1]!.x, placed[2]!.x]).toEqual([480, 480]);
      expect([placed[1]!.y, placed[2]!.y]).toEqual([80, 308]);
      // ...and the lone source is centred against that 316px-tall stack.
      expect(placed[0]!.y).toBe(194);
      expect(placed[0]!.x).toBe(80);
    });

    it("adds vertical breathing room once a column holds three or more nodes", async () => {
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
      // 180px gap instead of 140px for a 3-wide layer.
      expect(targets.map((shape) => shape.y)).toEqual([80, 348, 616]);
      // Source centres against the 624px stack.
      expect(source!.y).toBe(348);
    });

    it("orders the first column by the model's y hint", async () => {
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
      // `second` has the smaller y hint, despite appearing later in the array.
      expect(firstColumn).toEqual(["Second", "First"]);
    });

    it("lays out a nine-node, nine-edge flow without collapsing any column", async () => {
      const { elements } = await runPayload(nestedFlow);

      const shapes = shapesOf(elements);
      expect(shapes).toHaveLength(9);
      expect(arrowsOf(elements)).toHaveLength(9);
      // Ranks are strictly increasing along every edge, so the flow gets one
      // column per rank, left to right, and the two nodes sharing the last rank
      // land in the same column.
      const xs = shapes.map((shape) => shape.x);
      expect(xs).toEqual([...xs].sort((a, b) => a - b));
      expect(new Set(xs).size).toBe(8);
      expect(xs.at(-1)).toBe(xs.at(-2));
      // Single-node columns are centred against the tallest one, which is the
      // last column's pair (316px).
      expect(shapes[0]!.y).toBe(194);
      expect([shapes[7]!.y, shapes[8]!.y]).toEqual([80, 308]);
      // The fan-out from `cache_hit` feeds two different columns, and the merge
      // into `render` is between them — no branch overlaps its sibling.
      expect(shapes[4]!.y).toBe(194);
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
        expect(el.roundness).toEqual(el.type === "rectangle" ? { type: 3 } : null);
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

    it("binds each label to its container with a 12px inset", async () => {
      const { elements } = await runPayload(shapeComparison);
      const texts = textByShapeId(elements);

      for (const shape of shapesOf(elements)) {
        const text = texts.get(shape.id)!;
        expect(text).toBeDefined();
        expect(shape.boundElements).toEqual([{ id: text.id, type: "text" }]);
        expect(text).toMatchObject({
          containerId: shape.id,
          x: shape.x + 12,
          y: shape.y + 12,
          width: Math.max(24, shape.width - 24),
          height: Math.max(24, shape.height - 24),
          backgroundColor: "transparent",
          fontSize: 16,
          fontFamily: 1,
          textAlign: "center",
          verticalAlign: "middle",
          autoResize: false,
        });
        expect(text.originalText).toBe(text.text);
      }
    });

    it("carries the shape's colours onto its label and arrow defaults", async () => {
      const { elements } = await runPayload({
        nodes: [
          { id: "a", label: "A", backgroundColor: "#ff0000", strokeColor: "#123456" },
          { id: "b", label: "B" },
        ],
        edges: [{ from: "a", to: "b" }],
      });

      const [first, second] = shapesOf(elements);
      expect(first).toMatchObject({ backgroundColor: "#ff0000", strokeColor: "#123456" });
      expect(textByShapeId(elements).get(first!.id)!.strokeColor).toBe("#123456");
      // Palette rotation is by array index, so the second node gets palette[1].
      expect(second).toMatchObject({ backgroundColor: "#e8f0fe", strokeColor: "#1e1e1e" });
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
      expect(to!.boundElements).toContainEqual({ id: arrow!.id, type: "arrow" });
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
        const [start, end] = arrow.points!;
        expect(start).toEqual([0, 0]);
        expect(arrow.width).toBe(Math.max(1, Math.abs(end![0])));
        expect(arrow.height).toBe(Math.max(1, Math.abs(end![1])));
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
      // 0.2 / 0.8 along the right edge, so the two arrows leave at different y.
      expect(fixedPoints).toEqual([
        [1, 0.2],
        [1, 0.8],
      ]);
      const ys = arrowsOf(elements).map((arrow) => arrow.y);
      expect(ys[0]).not.toBe(ys[1]);
    });

    it("binds vertically when the target sits far enough above or below", async () => {
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

      const arrows = arrowsOf(elements);
      // The 268px vertical offset outweighs the 400px horizontal one, so the
      // fixed point moves onto the top/bottom edges (y = 0 and y = 1).
      expect(arrows[0]!.startBinding!.fixedPoint).toEqual([0.2, 0]);
      expect(arrows[0]!.endBinding!.fixedPoint).toEqual([0.2, 1]);
      expect(arrows[2]!.startBinding!.fixedPoint).toEqual([0.8, 1]);
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

    it(
      "names the validation failure instead of reporting valid JSON as unparseable",
      async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});

        // `{"nodes":[]}` parses fine; it is rejected by the node validator. The
        // thrown message carries the validator's reason, because reporting a
        // valid payload as "invalid JSON" sends debugging in the wrong direction.
        await expect(runPayload(emptyNodes)).rejects.toThrow(
          /at least one node/,
        );
      },
    );

    it("recovers a diagram the model left in its reasoning channel", async () => {
      const { result, elements } = await run([
        { type: "response.reasoning_text.delta", delta: JSON.stringify(simpleFlow) },
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

    it(
      "falls back to streamed text when the fast path carries a bad parsed payload",
      async () => {
        // `nodes: []` satisfies the fast path's `Array.isArray` guard, then the
        // validator rejects it. The fast path is an optimisation, so it must not
        // be the only route to an answer: the good diagram in the streamed text
        // is used instead of being discarded.
        const { elements } = await run([
          ...deltasOf(JSON.stringify(simpleFlow)),
          completedEvent({ output_parsed: emptyNodes }),
        ]);

        expect(shapesOf(elements)).toHaveLength(4);
      },
    );
  });

  /* ── Failure modes ──────────────────────────────────────────────────────── */

  describe("failure modes", () => {
    it("refuses to call the model without an API key", async () => {
      vi.stubEnv("OPENAI_API_KEY", "");

      await expect(generateCanvasDocument("prompt", "label")).rejects.toThrow(
        "OPENAI_API_KEY is not configured",
      );
      expect(createMock).not.toHaveBeenCalled();
    });

    it("rejects an empty response instead of returning an empty canvas", async () => {
      await expect(run([completedEvent()])).rejects.toThrow(
        "OpenAI returned an empty canvas response",
      );
    });

    it("propagates a transport failure from the client", async () => {
      createMock.mockRejectedValueOnce(new Error("socket hang up"));

      await expect(generateCanvasDocument("prompt", "label")).rejects.toThrow(
        "socket hang up",
      );
    });
  });

  /* ── Known defects, pinned as expected failures ─────────────────────────── */

  describe("known defects, pinned as expected failures", () => {
    it("leaves the earlier node at its hint position when two nodes share an id", async () => {
      const { elements } = await runPayload(duplicateIds);

      // Behaviour today: rank/layout maps are keyed by id, so the last node with
      // a given id absorbs every layout write and the earlier one keeps the
      // coordinates the model hinted at (80 + 1*280).
      expect(shapesOf(elements).map((shape) => shape.x)).toEqual([80, 360, 480]);
      const orphan = shapesOf(elements)[1]!;
      expect(orphan.boundElements!.map((b) => b.type)).toEqual(["text"]);
    });

    it.fails("lays out both nodes when two nodes share an id", async () => {
      const { elements } = await runPayload(duplicateIds);

      // Same logical rank, so the two `task` nodes belong in the same column —
      // instead one escapes the layout pass entirely.
      const [entry, first, second] = shapesOf(elements);
      expect(entry!.x).toBe(80);
      expect(first!.x).toBe(second!.x);
    });

    it.fails("treats a null coordinate hint as no hint rather than as y = 0", async () => {
      const { elements } = await runPayload({
        nodes: [
          { id: "alpha", label: "Alpha", y: 500 },
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

      // `Number(null)` is 0 and 0 is finite, so the fallback for bad coordinates
      // never runs and `beta` jumps the queue. With the fallback, both nodes sit
      // in the same default row (y = 80) and the array order survives.
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
