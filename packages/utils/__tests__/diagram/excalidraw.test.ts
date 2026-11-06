import type { Diagram } from "@nimbus/types";
import { describe, expect, it } from "vitest";
import {
  buildExcalidrawFromDiagram,
  generateExcalidrawId,
} from "../../src/diagram/excalidraw";
import { layoutDiagram } from "../../src/diagram/layout";
import { parseDiagramPayload } from "../../src/diagram/parse";

const fixture = (): Diagram =>
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
  startBinding?: { elementId: string };
  endBinding?: { elementId: string };
};

describe("buildExcalidrawFromDiagram", () => {
  it("binds every arrow at both ends to a shape that exists", () => {
    const els = buildExcalidrawFromDiagram(fixture()) as unknown as El[];
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

  it("points every label at the container that lists it", () => {
    const els = buildExcalidrawFromDiagram(fixture()) as unknown as El[];
    const byId = new Map(els.map((e) => [e.id, e]));

    for (const text of els.filter((e) => e.type === "text")) {
      const container = byId.get(text.containerId!)!;
      expect(container.boundElements).toContainEqual({
        id: text.id,
        type: "text",
      });
    }
  });

  it("gives every element a unique id", () => {
    const els = buildExcalidrawFromDiagram(fixture()) as unknown as El[];

    expect(new Set(els.map((e) => e.id)).size).toBe(els.length);
  });

  it("matches the recorded output when its randomness is injected", () => {
    expect(
      buildExcalidrawFromDiagram(fixture(), deterministic()),
    ).toMatchSnapshot();
  });

  it("is byte-identical across runs with the same sources", () => {
    const a = buildExcalidrawFromDiagram(fixture(), deterministic());
    const b = buildExcalidrawFromDiagram(fixture(), deterministic());

    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("leaves a diagram with no edges as shapes and labels only", () => {
    const d: Diagram = { nodes: fixture().nodes.slice(0, 2), edges: [] };

    const els = buildExcalidrawFromDiagram(d) as unknown as El[];

    expect(els.map((e) => e.type)).toEqual([
      "ellipse",
      "text",
      "diamond",
      "text",
    ]);
  });

  it("skips an edge whose endpoint is missing", () => {
    const d = fixture();
    d.edges.push({ from: "start", to: "nowhere" });

    const arrows = buildExcalidrawFromDiagram(d).filter(
      (e) => (e as { type: string }).type === "arrow",
    );

    expect(arrows).toHaveLength(3);
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
