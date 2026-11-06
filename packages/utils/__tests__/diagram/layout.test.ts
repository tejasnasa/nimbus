import type { Diagram, DiagramEdge, DiagramNode } from "@nimbus/types";
import { describe, expect, it } from "vitest";
import { layoutDiagram, rectsOverlap } from "../../src/diagram/layout";

const node = (id: string, w = 180, h = 88): DiagramNode => ({
  id,
  shape: "rectangle",
  label: id,
  x: 0,
  y: 0,
  width: w,
  height: h,
});

const diagram = (ids: string[], edges: DiagramEdge[] = []): Diagram => ({
  nodes: ids.map((id) => node(id)),
  edges,
});

const ids = (n: number) => Array.from({ length: n }, (_, i) => `n${i}`);

const chain = (n: number): Diagram =>
  diagram(
    ids(n),
    ids(n)
      .slice(1)
      .map((id, i) => ({ from: `n${i}`, to: id })),
  );

/** A binary tree with `n` nodes, so layers have different widths. */
const tree = (n: number): Diagram =>
  diagram(
    ids(n),
    ids(n)
      .slice(1)
      .map((id, i) => ({ from: `n${Math.floor(i / 2)}`, to: id })),
  );

const noOverlaps = (d: Diagram) => {
  for (let i = 0; i < d.nodes.length; i++) {
    for (let j = i + 1; j < d.nodes.length; j++) {
      expect(
        rectsOverlap(d.nodes[i]!, d.nodes[j]!, 0, 0),
        `${d.nodes[i]!.id} overlaps ${d.nodes[j]!.id}`,
      ).toBe(false);
    }
  }
};

const byId = (d: Diagram) => new Map(d.nodes.map((n) => [n.id, n]));

describe("layoutDiagram", () => {
  it.each([1, 5, 30])("leaves no overlaps for %i connected nodes", (n) => {
    noOverlaps(layoutDiagram(tree(n)));
    noOverlaps(layoutDiagram(tree(n), { direction: "TB" }));
  });

  it.each([1, 5, 30])("leaves no overlaps for %i edgeless nodes", (n) => {
    noOverlaps(layoutDiagram(diagram(ids(n))));
  });

  it("puts every edge's target in a later column when flowing left to right", () => {
    const d = layoutDiagram(tree(12));
    const nodes = byId(d);

    for (const e of d.edges) {
      expect(nodes.get(e.to)!.x).toBeGreaterThan(nodes.get(e.from)!.x);
    }
  });

  it("puts every edge's target in a later row when flowing top to bottom", () => {
    const d = layoutDiagram(tree(12), { direction: "TB" });
    const nodes = byId(d);

    for (const e of d.edges) {
      expect(nodes.get(e.to)!.y).toBeGreaterThan(nodes.get(e.from)!.y);
    }
  });

  it("lays a chain out on one row for LR and one column for TB", () => {
    const lr = layoutDiagram(chain(4));
    const tb = layoutDiagram(chain(4), { direction: "TB" });

    expect(new Set(lr.nodes.map((n) => n.y)).size).toBe(1);
    expect(new Set(tb.nodes.map((n) => n.x)).size).toBe(1);
  });

  it("uses the diagram's own direction unless an option overrides it", () => {
    const hinted = { ...chain(3), direction: "TB" as const };
    expect(new Set(layoutDiagram(hinted).nodes.map((n) => n.x)).size).toBe(1);

    const overridden = { ...chain(3), direction: "TB" as const };
    expect(
      new Set(
        layoutDiagram(overridden, { direction: "LR" }).nodes.map((n) => n.y),
      ).size,
    ).toBe(1);
  });

  it("terminates on a cycle and keeps it on a compact canvas", () => {
    const d = layoutDiagram(
      diagram(
        ["a", "b", "c"],
        [
          { from: "a", to: "b" },
          { from: "b", to: "c" },
          { from: "c", to: "a" },
        ],
      ),
    );

    noOverlaps(d);
    expect(Math.max(...d.nodes.map((n) => n.x))).toBeLessThan(2000);
  });

  it("is deterministic for the same input", () => {
    const first = layoutDiagram(tree(15)).nodes.map((n) => [n.id, n.x, n.y]);
    const second = layoutDiagram(tree(15)).nodes.map((n) => [n.id, n.x, n.y]);

    expect(second).toEqual(first);
  });

  it("copes with an edge that names a node that is not there", () => {
    const d = diagram(
      ["a", "b"],
      [
        { from: "a", to: "b" },
        { from: "ghost", to: "b" },
      ],
    );

    expect(() => layoutDiagram(d)).not.toThrow();
    noOverlaps(d);
  });

  it("breaks ties between first-layer nodes by their other coordinate", () => {
    const lr = diagram(
      ["a", "b", "c"],
      [
        { from: "a", to: "c" },
        { from: "b", to: "c" },
      ],
    );
    // Same y hint, so x decides.
    lr.nodes[0]!.x = 500;
    lr.nodes[1]!.x = 100;
    layoutDiagram(lr);
    expect(byId(lr).get("b")!.y).toBeLessThan(byId(lr).get("a")!.y);

    const tb = diagram(
      ["a", "b", "c"],
      [
        { from: "a", to: "c" },
        { from: "b", to: "c" },
      ],
    );
    // Same x hint, so y decides.
    tb.nodes[0]!.y = 500;
    tb.nodes[1]!.y = 100;
    layoutDiagram(tb, { direction: "TB" });
    expect(byId(tb).get("b")!.x).toBeLessThan(byId(tb).get("a")!.x);

    const byX = diagram(
      ["a", "b", "c"],
      [
        { from: "a", to: "c" },
        { from: "b", to: "c" },
      ],
    );
    byX.nodes[0]!.x = 500;
    byX.nodes[1]!.x = 100;
    layoutDiagram(byX, { direction: "TB" });
    expect(byId(byX).get("b")!.x).toBeLessThan(byId(byX).get("a")!.x);
  });

  it("orders later layers by where their predecessors ended up", () => {
    const d = diagram(
      ["r1", "r2", "x", "y"],
      [
        { from: "r1", to: "y" },
        { from: "r2", to: "x" },
      ],
    );
    d.nodes[0]!.y = 0;
    d.nodes[1]!.y = 300;

    layoutDiagram(d);

    // y hangs off the upper root and x off the lower one, so y sits above x.
    expect(byId(d).get("y")!.y).toBeLessThan(byId(d).get("x")!.y);
  });

  it("lays out a larger cycle with a chord without overlapping", () => {
    const d = diagram(
      ["a", "b", "c", "d"],
      [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "c", to: "d" },
        { from: "d", to: "a" },
        { from: "d", to: "b" },
      ],
    );

    layoutDiagram(d);
    layoutDiagram(d, { direction: "TB" });

    noOverlaps(d);
  });

  it("returns an empty diagram untouched", () => {
    const d: Diagram = { nodes: [], edges: [] };

    expect(layoutDiagram(d)).toBe(d);
  });

  it("orders the first layer by the model's own hints", () => {
    const d = diagram(
      ["a", "b", "c"],
      [
        { from: "a", to: "c" },
        { from: "b", to: "c" },
      ],
    );
    d.nodes[0]!.y = 300;
    d.nodes[1]!.y = 10;

    layoutDiagram(d);

    expect(byId(d).get("b")!.y).toBeLessThan(byId(d).get("a")!.y);
  });
});
