import type { Diagram, DiagramEdge, DiagramNode } from "@nimbus/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  layoutDiagram,
  layoutDiagramFallback,
  rectsOverlap,
} from "../../src/diagram/layout";
import {
  chainSpec,
  countOverlaps,
  countRouteBoxHits,
  distanceToBorder,
  makeDiagram,
} from "./geometry";

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

/** A binary tree with `n` nodes, so layers have different widths. */
const tree = (n: number): Diagram =>
  diagram(
    ids(n),
    ids(n)
      .slice(1)
      .map((id, i) => ({ from: `n${Math.floor(i / 2)}`, to: id })),
  );

const noOverlaps = (d: Diagram, pad = 0) => {
  for (let i = 0; i < d.nodes.length; i++) {
    for (let j = i + 1; j < d.nodes.length; j++) {
      expect(
        rectsOverlap(d.nodes[i]!, d.nodes[j]!, pad, pad),
        `${d.nodes[i]!.id} overlaps ${d.nodes[j]!.id}`,
      ).toBe(false);
    }
  }
};

const byId = (d: Diagram) => new Map(d.nodes.map((n) => [n.id, n]));

/** Realistic diagrams, built through the parser so nodes are label-sized. */
const realistic: Record<string, () => Diagram> = {
  chain: () => makeDiagram(chainSpec(6)),
  "fan-out": () =>
    makeDiagram({
      nodes: ["Gateway", "Auth", "Billing", "Search", "Notifications", "Audit"],
      edges: [
        ["Gateway", "Auth"],
        ["Gateway", "Billing"],
        ["Gateway", "Search"],
        ["Gateway", "Notifications"],
        ["Gateway", "Audit"],
      ],
    }),
  diamond: () =>
    makeDiagram({
      nodes: ["Start", "Left branch", "Right branch", "Join"],
      edges: [
        ["Start", "Left branch"],
        ["Start", "Right branch"],
        ["Left branch", "Join"],
        ["Right branch", "Join"],
      ],
    }),
  cycle: () =>
    makeDiagram({
      nodes: ["Plan", "Build", "Test", "Release"],
      edges: [
        ["Plan", "Build"],
        ["Build", "Test"],
        ["Test", "Release"],
        ["Release", "Plan"],
      ],
    }),
  "25-node flow": () => {
    const verbs = ["ingest", "validate", "route", "store", "notify"];
    const nodes = Array.from({ length: 25 }, (_, i) => ({
      id: `s${i}`,
      label: `Service ${i} handles ${verbs[i % 5]}`,
    }));
    const edges: [string, string][] = [];
    for (let i = 1; i < 25; i++) {
      edges.push([`s${Math.floor((i - 1) / 2)}`, `s${i}`]);
    }
    for (let i = 3; i < 25; i += 4) edges.push([`s${i - 3}`, `s${i}`]);
    return makeDiagram({ nodes, edges });
  },
  "long labels": () =>
    makeDiagram({
      nodes: [
        {
          id: "a",
          label:
            "Validate the incoming request payload against the published schema and reject anything malformed",
        },
        {
          id: "b",
          label:
            "Supercalifragilisticexpialidocious_identifier_that_never_ends_anywhere",
        },
        { id: "c", label: "短い 日本語のラベルがここにあります 😀😀" },
        { id: "d", label: "Done" },
      ],
      edges: [
        ["a", "b"],
        ["a", "c"],
        ["b", "d"],
        ["c", "d"],
      ],
    }),
  "mixed shapes": () =>
    makeDiagram({
      nodes: [
        { id: "start", shape: "ellipse", label: "Start" },
        { id: "check", shape: "diamond", label: "Is the input valid?" },
        { id: "save", shape: "rectangle", label: "Save record" },
        { id: "reject", shape: "ellipse", label: "Reject request" },
      ],
      edges: [
        ["start", "check"],
        ["check", "save"],
        ["check", "reject"],
      ],
    }),
};

describe("layoutDiagram", () => {
  it.each([1, 5, 30])(
    "leaves no overlaps for %i connected nodes",
    async (n) => {
      noOverlaps(await layoutDiagram(tree(n)));
      noOverlaps(await layoutDiagram(tree(n), { direction: "TB" }));
    },
  );

  it.each([1, 5, 30])("leaves no overlaps for %i edgeless nodes", async (n) => {
    noOverlaps(await layoutDiagram(diagram(ids(n))));
  });

  it("puts every edge target in a later column when flowing left to right", async () => {
    const d = await layoutDiagram(tree(12));
    const nodes = byId(d);

    for (const e of d.edges) {
      expect(nodes.get(e.to)!.x).toBeGreaterThan(nodes.get(e.from)!.x);
    }
  });

  it("puts every edge target in a later row when flowing top to bottom", async () => {
    const d = await layoutDiagram(tree(12), { direction: "TB" });
    const nodes = byId(d);

    for (const e of d.edges) {
      expect(nodes.get(e.to)!.y).toBeGreaterThan(nodes.get(e.from)!.y);
    }
  });

  it("lays a chain out on one row for LR and one column for TB", async () => {
    const lr = await layoutDiagram(makeDiagram(chainSpec(4)));
    const tb = await layoutDiagram(makeDiagram(chainSpec(4)), {
      direction: "TB",
    });

    const centers = (d: Diagram, axis: "x" | "y") =>
      new Set(
        d.nodes.map((n) =>
          axis === "x" ? n.x + n.width / 2 : n.y + n.height / 2,
        ),
      );

    expect(centers(lr, "y").size).toBe(1);
    expect(centers(tb, "x").size).toBe(1);
  });

  it("uses the diagram direction unless an option overrides it", async () => {
    const hinted = { ...makeDiagram(chainSpec(3)), direction: "TB" as const };
    const hintedOut = await layoutDiagram(hinted);
    expect(hintedOut.nodes[2]!.y).toBeGreaterThan(hintedOut.nodes[0]!.y);

    const overridden = {
      ...makeDiagram(chainSpec(3)),
      direction: "TB" as const,
    };
    const out = await layoutDiagram(overridden, { direction: "LR" });
    expect(out.nodes[2]!.x).toBeGreaterThan(out.nodes[0]!.x);
    expect(out.nodes[2]!.y + out.nodes[2]!.height / 2).toBe(
      out.nodes[0]!.y + out.nodes[0]!.height / 2,
    );
  });

  it("terminates on a cycle and keeps it on a compact canvas", async () => {
    const d = await layoutDiagram(
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

  it("is deterministic for the same input", async () => {
    const run = async () => {
      const d = await layoutDiagram(tree(15));
      return JSON.stringify([d.nodes.map((n) => [n.id, n.x, n.y]), d.routes]);
    };

    expect(await run()).toBe(await run());
  });

  it("copes with an edge that names a node that is not there", async () => {
    const d = diagram(
      ["a", "b"],
      [
        { from: "a", to: "b" },
        { from: "ghost", to: "b" },
      ],
    );

    await expect(layoutDiagram(d)).resolves.toBe(d);
    noOverlaps(d);
    expect(d.routes![0]).not.toBeNull();
    expect(d.routes![1]).toBeNull();
  });

  it("falls to the grid when every edge is unusable", async () => {
    const d = diagram(["a", "b"], [{ from: "ghost", to: "b" }]);

    await layoutDiagram(d);

    expect(d.routes).toBeUndefined();
    noOverlaps(d);
  });

  it("orders first-layer nodes by the order the model listed them", async () => {
    const d = makeDiagram({
      nodes: ["a", "b", "c"],
      edges: [
        ["a", "c"],
        ["b", "c"],
      ],
    });

    await layoutDiagram(d);

    expect(byId(d).get("a")!.y).toBeLessThan(byId(d).get("b")!.y);
  });

  it("orders later layers by where their predecessors ended up", async () => {
    const d = makeDiagram({
      nodes: ["r1", "r2", "x", "y"],
      edges: [
        ["r1", "y"],
        ["r2", "x"],
      ],
    });

    await layoutDiagram(d);

    // y hangs off the upper root and x off the lower one, so y sits above x.
    expect(byId(d).get("y")!.y).toBeLessThan(byId(d).get("x")!.y);
  });

  it("lays out a larger cycle with a chord without overlapping", async () => {
    const edges: [string, string][] = [
      ["a", "b"],
      ["b", "c"],
      ["c", "d"],
      ["d", "a"],
      ["d", "b"],
    ];
    const nodes = ["a", "b", "c", "d"];
    const lr = await layoutDiagram(makeDiagram({ nodes, edges }));
    const tb = await layoutDiagram(makeDiagram({ nodes, edges }), {
      direction: "TB",
    });

    noOverlaps(lr, 16);
    noOverlaps(tb, 16);
  });

  it("returns an empty diagram untouched", async () => {
    const d: Diagram = { nodes: [], edges: [] };

    await expect(layoutDiagram(d)).resolves.toBe(d);
  });

  it("starts the drawing at the canvas margin", async () => {
    const d = await layoutDiagram(makeDiagram(chainSpec(3)));

    expect(Math.min(...d.nodes.map((n) => n.x))).toBe(80);
    expect(Math.min(...d.nodes.map((n) => n.y))).toBe(80);
  });
});

describe("ELK layout of realistic diagrams", () => {
  describe.each(Object.entries(realistic))("%s", (_name, make) => {
    it.each(["LR", "TB"] as const)(
      "keeps every box clear (%s)",
      async (dir) => {
        const d = await layoutDiagram(make(), { direction: dir });

        expect(countOverlaps(d.nodes, 16)).toBe(0);
      },
    );

    it("routes every edge as an orthogonal polyline that avoids other boxes", async () => {
      const d = await layoutDiagram(make());

      expect(d.routes).toHaveLength(d.edges.length);
      for (const route of d.routes!) {
        expect(route).not.toBeNull();
        expect(route!.length).toBeGreaterThanOrEqual(2);
        for (let k = 0; k + 1 < route!.length; k++) {
          const [p, q] = [route![k]!, route![k + 1]!];
          expect(
            Math.abs(p.x - q.x) < 0.5 || Math.abs(p.y - q.y) < 0.5,
            "segment is axis-aligned",
          ).toBe(true);
        }
      }
      expect(countRouteBoxHits(d, d.routes!)).toBe(0);
    });

    it("starts and ends each route on its own boxes", async () => {
      const d = await layoutDiagram(make());
      const nodes = byId(d);

      d.edges.forEach((edge, i) => {
        const route = d.routes![i]!;
        const from = nodes.get(edge.from)!;
        const to = nodes.get(edge.to)!;

        if (from.shape === "rectangle") {
          expect(distanceToBorder(route[0]!, from)).toBeLessThanOrEqual(1);
        }
        if (to.shape === "rectangle") {
          expect(
            distanceToBorder(route[route.length - 1]!, to),
          ).toBeLessThanOrEqual(1);
        }
      });
    });
  });

  it("puts ellipse and diamond arrow ends on the drawn outline", async () => {
    const d = await layoutDiagram(realistic["mixed shapes"]!());
    const nodes = byId(d);

    d.edges.forEach((edge, i) => {
      const route = d.routes![i]!;
      for (const [id, p] of [
        [edge.from, route[0]!],
        [edge.to, route[route.length - 1]!],
      ] as const) {
        const n = nodes.get(id)!;
        const nx = Math.abs(p.x - (n.x + n.width / 2)) / (n.width / 2);
        const ny = Math.abs(p.y - (n.y + n.height / 2)) / (n.height / 2);
        if (n.shape === "ellipse") {
          expect(nx * nx + ny * ny).toBeCloseTo(1, 1);
        } else if (n.shape === "diamond") {
          expect(nx + ny).toBeCloseTo(1, 1);
        } else {
          expect(Math.max(nx, ny)).toBeCloseTo(1, 1);
        }
      }
    });
  });

  it("flows left to right and top to bottom as asked", async () => {
    const lr = await layoutDiagram(realistic.diamond!(), { direction: "LR" });
    const tb = await layoutDiagram(realistic.diamond!(), { direction: "TB" });
    const [lrStart, , , lrJoin] = lr.nodes;
    const [tbStart, , , tbJoin] = tb.nodes;

    expect(lrJoin!.x).toBeGreaterThan(lrStart!.x + lrStart!.width);
    expect(tbJoin!.y).toBeGreaterThan(tbStart!.y + tbStart!.height);
  });

  it("keeps components of a disconnected diagram apart", async () => {
    const d = await layoutDiagram(
      makeDiagram({
        nodes: ["a", "b", "c", "d", "lone"],
        edges: [
          ["a", "b"],
          ["c", "d"],
        ],
      }),
    );

    expect(countOverlaps(d.nodes, 16)).toBe(0);
  });
});

describe("edgeless grid", () => {
  it("sizes cells from the nodes so wide and tall labels never collide", async () => {
    const d = makeDiagram({
      nodes: [
        {
          id: "a",
          label: "A fairly long label that needs several wrapped lines to fit",
        },
        { id: "b", label: "B" },
        { id: "c", label: "Cheese ".repeat(30) },
        { id: "d", label: "D" },
        { id: "e", label: "A diamond", shape: "diamond" },
        { id: "f", label: "An ellipse with text", shape: "ellipse" },
        { id: "g", label: "G" },
      ],
    });

    await layoutDiagram(d);

    expect(countOverlaps(d.nodes, 40)).toBe(0);
    expect(d.routes).toBeUndefined();
  });

  it("uses roughly square columns", async () => {
    const d = await layoutDiagram(diagram(ids(9)));

    expect(new Set(d.nodes.map((n) => n.x)).size).toBe(3);
    expect(new Set(d.nodes.map((n) => n.y)).size).toBe(3);
  });
});

describe("fallback", () => {
  afterEach(() => {
    vi.doUnmock("elkjs/lib/elk.bundled.js");
    vi.resetModules();
    vi.restoreAllMocks();
  });

  /** Re-imports the layout with ELK replaced by a stand-in class. */
  const withElk = async (impl: {
    layout: (g: unknown) => Promise<unknown>;
  }) => {
    vi.resetModules();
    vi.doMock("elkjs/lib/elk.bundled.js", () => ({
      default: class {
        layout = impl.layout;
        terminateWorker() {}
      },
    }));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    return import("../../src/diagram/layout");
  };

  it("uses the rank-based layout when ELK rejects", async () => {
    const mod = await withElk({
      layout: () => Promise.reject(new Error("boom")),
    });
    const d = makeDiagram(chainSpec(5));
    const expected = layoutDiagramFallback(makeDiagram(chainSpec(5)));

    const out = await mod.layoutDiagram(d);

    expect(out.routes).toBeUndefined();
    expect(out.nodes.map((n) => [n.x, n.y])).toEqual(
      expected.nodes.map((n) => [n.x, n.y]),
    );
    expect(console.warn).toHaveBeenCalled();
  });

  it("uses the fallback when ELK exceeds its time budget", async () => {
    const mod = await withElk({ layout: () => new Promise(() => {}) });
    const d = makeDiagram(chainSpec(4));

    const out = await mod.layoutDiagram(d, { timeoutMs: 20 });

    expect(out.routes).toBeUndefined();
    expect(countOverlaps(out.nodes)).toBe(0);
  });

  it("uses the fallback when ELK returns an unplaced node", async () => {
    const mod = await withElk({
      layout: async () => ({ id: "root", children: [{ id: "n0" }], edges: [] }),
    });

    const out = await mod.layoutDiagram(makeDiagram(chainSpec(3)));

    expect(out.routes).toBeUndefined();
    expect(out.nodes.every((n) => Number.isFinite(n.x))).toBe(true);
  });

  it("uses the fallback when ELK drops a node", async () => {
    const mod = await withElk({
      layout: async () => ({
        id: "root",
        children: [{ id: "n0", x: 0, y: 0 }],
        edges: [],
      }),
    });

    const out = await mod.layoutDiagram(makeDiagram(chainSpec(3)));

    expect(out.routes).toBeUndefined();
  });

  it("uses the fallback when ELK returns a malformed route", async () => {
    const d = makeDiagram(chainSpec(2));
    const mod = await withElk({
      layout: async () => ({
        id: "root",
        children: d.nodes.map((n, i) => ({ id: n.id, x: i * 300, y: 0 })),
        edges: [
          {
            id: "e0",
            sections: [
              { startPoint: { x: NaN, y: 0 }, endPoint: { x: 1, y: 1 } },
            ],
          },
        ],
      }),
    });

    const out = await mod.layoutDiagram(d);

    expect(out.routes).toBeUndefined();
  });

  it("ignores an ELK edge that came back without a route", async () => {
    const d = makeDiagram(chainSpec(2));
    const mod = await withElk({
      layout: async () => ({
        id: "root",
        children: d.nodes.map((n, i) => ({ id: n.id, x: i * 300, y: 0 })),
        edges: [{ id: "e0" }],
      }),
    });

    const out = await mod.layoutDiagram(d);

    expect(out.routes).toEqual([null]);
  });

  it("decides positions by the fallback, not a half-applied ELK result", async () => {
    const mod = await withElk({
      layout: () => Promise.reject(new Error("x")),
    });
    const d = makeDiagram(chainSpec(3));
    d.nodes.forEach((n) => {
      n.x = 1234;
      n.y = 5678;
    });

    const out = await mod.layoutDiagram(d);

    expect(out.nodes[0]!.x).not.toBe(1234);
  });

  it("skips ELK for a diagram over the size limit", async () => {
    const layout = vi.fn(() => Promise.reject(new Error("should not run")));
    const mod = await withElk({ layout });

    const out = await mod.layoutDiagram(makeDiagram(chainSpec(6)), {
      maxElkNodes: 3,
    });

    expect(layout).not.toHaveBeenCalled();
    expect(out.routes).toBeUndefined();
    expect(countOverlaps(out.nodes)).toBe(0);
  });

  it("accepts a CommonJS-shaped ELK export", async () => {
    vi.resetModules();
    vi.doMock("elkjs/lib/elk.bundled.js", () => ({
      default: {
        default: class {
          layout() {
            return Promise.reject(new Error("nested"));
          }
          terminateWorker() {}
        },
      },
    }));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await import("../../src/diagram/layout");

    const out = await mod.layoutDiagram(makeDiagram(chainSpec(2)));

    expect(out.routes).toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("fallback"),
      "nested",
    );
  });

  it("lays out with the fallback directly, top to bottom as well", () => {
    const d = layoutDiagramFallback(makeDiagram(chainSpec(4)), "TB");

    expect(d.nodes[3]!.y).toBeGreaterThan(d.nodes[0]!.y);
    expect(layoutDiagramFallback({ nodes: [], edges: [] }).nodes).toEqual([]);
    expect(
      layoutDiagramFallback(makeDiagram({ nodes: ["a", "b"] })).nodes,
    ).toHaveLength(2);
  });
});

describe("rank-based fallback", () => {
  it("breaks ties between first-layer nodes by their other coordinate", () => {
    const edges = [
      { from: "a", to: "c" },
      { from: "b", to: "c" },
    ];
    const lr = diagram(["a", "b", "c"], edges);
    // Same y hint, so x decides.
    lr.nodes[0]!.x = 500;
    lr.nodes[1]!.x = 100;
    layoutDiagramFallback(lr);
    expect(byId(lr).get("b")!.y).toBeLessThan(byId(lr).get("a")!.y);

    const tb = diagram(["a", "b", "c"], edges);
    // Same x hint, so y decides.
    tb.nodes[0]!.y = 500;
    tb.nodes[1]!.y = 100;
    layoutDiagramFallback(tb, "TB");
    expect(byId(tb).get("b")!.x).toBeLessThan(byId(tb).get("a")!.x);

    const byX = diagram(["a", "b", "c"], edges);
    byX.nodes[0]!.x = 500;
    byX.nodes[1]!.x = 100;
    layoutDiagramFallback(byX, "TB");
    expect(byId(byX).get("b")!.x).toBeLessThan(byId(byX).get("a")!.x);
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

    layoutDiagramFallback(d);

    expect(byId(d).get("b")!.y).toBeLessThan(byId(d).get("a")!.y);
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

    layoutDiagramFallback(d);

    expect(byId(d).get("y")!.y).toBeLessThan(byId(d).get("x")!.y);
  });

  it("terminates on a cycle with a chord and leaves no overlaps", () => {
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

    layoutDiagramFallback(d);
    noOverlaps(d);
    layoutDiagramFallback(d, "TB");
    noOverlaps(d);
  });

  it("wraps edgeless nodes into a grid", () => {
    const d = layoutDiagramFallback(diagram(ids(9)));

    noOverlaps(d);
    expect(new Set(d.nodes.map((n) => n.y)).size).toBe(3);
  });
});
