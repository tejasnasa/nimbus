import type { Diagram } from "@nimbus/types";
import { describe, expect, it } from "vitest";
import {
  buildExcalidrawFromDiagram,
  generateExcalidrawId,
} from "../../src/diagram/excalidraw";
import { layoutDiagram, type LaidOutDiagram } from "../../src/diagram/layout";
import { measureLabel } from "../../src/diagram/measure";
import {
  LABEL_FONT_SIZE,
  LABEL_LINE_HEIGHT,
  labelArea,
  parseDiagramPayload,
} from "../../src/diagram/parse";
import { makeDiagram } from "./geometry";

const fixture = async (): Promise<LaidOutDiagram> =>
  layoutDiagram(
    parseDiagramPayload(
      JSON.stringify({
        nodes: [
          { id: "start", shape: "ellipse", label: "Start" },
          { id: "check", shape: "diamond", label: "Valid?" },
          { id: "save", shape: "rectangle", label: "Save" },
          { id: "reject", shape: "rectangle", label: "Reject" },
        ],
        edges: [
          { from: "start", to: "check" },
          { from: "check", to: "save" },
          { from: "check", to: "reject" },
        ],
      }),
    ),
  );

/** Stable sources for every id, seed and timestamp. */
const deterministic = () => {
  let ids = 0;
  let draws = 0;
  return {
    generateId: () => `id${String(ids++).padStart(8, "0")}`,
    random: () => ((draws++ * 7919) % 1000) / 1000,
    now: () => 1_700_000_000_000,
  };
};

type El = {
  id: string;
  type: string;
  containerId?: string;
  boundElements: { id: string; type: string }[] | null;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  points?: [number, number][];
  startBinding?: { elementId: string; fixedPoint: [number, number] };
  endBinding?: { elementId: string; fixedPoint: [number, number] };
};

describe("buildExcalidrawFromDiagram", () => {
  it("binds every arrow at both ends to a shape that exists", async () => {
    const els = buildExcalidrawFromDiagram(await fixture()) as unknown as El[];
    const shapes = new Map(
      els
        .filter((e) => e.type !== "text" && e.type !== "arrow")
        .map((e) => [e.id, e]),
    );
    const arrows = els.filter((e) => e.type === "arrow");

    expect(arrows).toHaveLength(3);
    for (const arrow of arrows) {
      const from = shapes.get(arrow.startBinding!.elementId);
      const to = shapes.get(arrow.endBinding!.elementId);
      expect(from).toBeDefined();
      expect(to).toBeDefined();
      expect(from!.boundElements).toContainEqual({
        id: arrow.id,
        type: "arrow",
      });
      expect(to!.boundElements).toContainEqual({ id: arrow.id, type: "arrow" });
    }
  });

  it("points every label at the container that lists it", async () => {
    const els = buildExcalidrawFromDiagram(await fixture()) as unknown as El[];
    const byId = new Map(els.map((e) => [e.id, e]));

    for (const text of els.filter((e) => e.type === "text")) {
      const container = byId.get(text.containerId!)!;
      expect(container.boundElements).toContainEqual({
        id: text.id,
        type: "text",
      });
    }
  });

  it("gives every element a unique id", async () => {
    const els = buildExcalidrawFromDiagram(await fixture()) as unknown as El[];

    expect(new Set(els.map((e) => e.id)).size).toBe(els.length);
  });

  it("matches the recorded output when its randomness is injected", async () => {
    expect(
      buildExcalidrawFromDiagram(await fixture(), deterministic()),
    ).toMatchSnapshot();
  });

  it("is byte-identical across runs with the same sources", async () => {
    const a = buildExcalidrawFromDiagram(await fixture(), deterministic());
    const b = buildExcalidrawFromDiagram(await fixture(), deterministic());

    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("leaves a diagram with no edges as shapes and labels only", async () => {
    const d: Diagram = {
      nodes: (await fixture()).nodes.slice(0, 2),
      edges: [],
    };

    const els = buildExcalidrawFromDiagram(d) as unknown as El[];

    expect(els.map((e) => e.type)).toEqual([
      "ellipse",
      "text",
      "diamond",
      "text",
    ]);
  });

  it("skips an edge whose endpoint is missing", async () => {
    const d = await fixture();
    d.edges.push({ from: "start", to: "nowhere" });

    const arrows = buildExcalidrawFromDiagram(d).filter(
      (e) => (e as { type: string }).type === "arrow",
    );

    expect(arrows).toHaveLength(3);
  });
});

describe("routed arrows", () => {
  const els = async () => {
    const d = await fixture();
    return {
      d,
      out: buildExcalidrawFromDiagram(d, deterministic()) as unknown as El[],
    };
  };

  it("follows every bend point of the layout route", async () => {
    const { d, out } = await els();
    const arrows = out.filter((e) => e.type === "arrow");

    arrows.forEach((arrow, i) => {
      const route = d.routes![i]!;
      expect(arrow.x).toBe(route[0]!.x);
      expect(arrow.y).toBe(route[0]!.y);
      expect(arrow.points).toHaveLength(route.length);
      arrow.points!.forEach(([px, py], k) => {
        expect(px).toBeCloseTo(route[k]!.x - route[0]!.x);
        expect(py).toBeCloseTo(route[k]!.y - route[0]!.y);
      });
      expect(arrow.points![0]).toEqual([0, 0]);
    });
  });

  it("derives binding fixed points from where the route meets each box", async () => {
    const { d, out } = await els();
    const shapes = new Map(out.map((e) => [e.id, e]));

    for (const arrow of out.filter((e) => e.type === "arrow")) {
      const last = arrow.points![arrow.points!.length - 1]!;
      for (const [binding, px, py] of [
        [arrow.startBinding!, arrow.x, arrow.y],
        [arrow.endBinding!, arrow.x + last[0], arrow.y + last[1]],
      ] as const) {
        const shape = shapes.get(binding.elementId)!;
        const [fx, fy] = binding.fixedPoint;
        expect(shape.x + fx * shape.width).toBeCloseTo(px, 5);
        expect(shape.y + fy * shape.height).toBeCloseTo(py, 5);
      }
    }
    expect(d.routes).toBeDefined();
  });

  it("sizes the arrow box to its points and never below one pixel", async () => {
    const { out } = await els();

    for (const arrow of out.filter((e) => e.type === "arrow")) {
      const xs = arrow.points!.map((p) => p[0]);
      const ys = arrow.points!.map((p) => p[1]);
      expect(arrow.width).toBe(Math.max(1, Math.max(...xs) - Math.min(...xs)));
      expect(arrow.height).toBe(Math.max(1, Math.max(...ys) - Math.min(...ys)));
    }
  });

  it("falls back to a straight two-point connector for an edge with no route", async () => {
    const d = await fixture();
    d.routes = undefined;

    const arrows = (buildExcalidrawFromDiagram(d) as unknown as El[]).filter(
      (e) => e.type === "arrow",
    );

    expect(arrows).toHaveLength(3);
    for (const arrow of arrows) expect(arrow.points).toHaveLength(2);
  });

  it("keeps routed and unrouted edges in one diagram", async () => {
    const d = await fixture();
    d.routes![1] = null;

    const arrows = (buildExcalidrawFromDiagram(d) as unknown as El[]).filter(
      (e) => e.type === "arrow",
    );

    expect(arrows.map((a) => a.points!.length > 2)).toContain(true);
    expect(arrows[1]!.points).toHaveLength(2);
  });
});

describe("label text elements", () => {
  it("measures the same as the node sizing and fits inside the shape", async () => {
    const d = makeDiagram({
      nodes: [
        {
          id: "r",
          label: "A rectangle holding a fairly long label that wraps",
        },
        {
          id: "e",
          shape: "ellipse",
          label: "An ellipse holding a long label too",
        },
        {
          id: "d",
          shape: "diamond",
          label: "A diamond with its own long label",
        },
        { id: "cjk", label: "日本語のラベルが長いときの折り返し確認 😀" },
      ],
    });
    await layoutDiagram(d);

    const out = buildExcalidrawFromDiagram(d) as unknown as El[];
    const byId = new Map(out.map((e) => [e.id, e]));

    out
      .filter((e) => e.type === "text")
      .forEach((text, i) => {
        const shape = byId.get(text.containerId!)!;
        const node = d.nodes[i]!;
        const area = labelArea(node.shape, shape.width, shape.height);
        const m = measureLabel(text.text!, {
          fontSize: LABEL_FONT_SIZE,
          lineHeight: LABEL_LINE_HEIGHT,
          maxWidth: Infinity,
        });

        expect(m.width).toBeLessThanOrEqual(text.width);
        expect(text.width).toBeCloseTo(area.width);
        expect(text.height).toBe(m.height);
        expect(text.height).toBeLessThanOrEqual(area.height);
        expect(text.x + text.width / 2).toBeCloseTo(shape.x + shape.width / 2);
        expect(text.y + text.height / 2).toBeCloseTo(
          shape.y + shape.height / 2,
        );
      });
  });
});

describe("arrow anchors", () => {
  const box = (id: string, x: number, y: number) => ({
    id,
    shape: "rectangle" as const,
    label: id,
    x,
    y,
    width: 180,
    height: 88,
  });

  it("leaves a shape by the side that faces its target", () => {
    const diagram: Diagram = {
      nodes: [
        box("origin", 0, 0),
        box("right", 600, 0),
        box("left", -600, 0),
        box("above", 0, -400),
        box("below", 0, 400),
      ],
      edges: ["right", "left", "above", "below"].map((to) => ({
        from: "origin",
        to,
      })),
    };

    const els = buildExcalidrawFromDiagram(diagram) as unknown as Array<{
      type: string;
      startBinding?: { fixedPoint: [number, number] };
    }>;
    const starts = els
      .filter((e) => e.type === "arrow")
      .map((e) => e.startBinding!.fixedPoint);

    // Four edges fan out of one shape, so the sliding coordinate differs while
    // the side is fixed by the target's direction.
    expect(starts.map(([x, y]) => (x === 1 || x === 0 ? x : y))).toEqual([
      1, 0, 0, 1,
    ]);
  });
});

describe("generateExcalidrawId", () => {
  it("pads a short draw to ten characters", () => {
    expect(generateExcalidrawId(() => 0.5)).toMatch(/^[a-z0-9]{10}$/);
  });
});
