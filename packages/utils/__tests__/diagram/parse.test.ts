import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractJsonObject,
  parseDiagramPayload,
} from "../../src/diagram/parse";

const flow = {
  nodes: [
    { id: "a", shape: "rectangle", label: "Start" },
    { id: "b", shape: "diamond", label: "Decide" },
    { id: "c", shape: "ellipse", label: "End" },
  ],
  edges: [
    { from: "a", to: "b" },
    { from: "b", to: "c" },
  ],
};

afterEach(() => vi.restoreAllMocks());

describe("parseDiagramPayload", () => {
  it("parses a bare JSON object", () => {
    const diagram = parseDiagramPayload(JSON.stringify(flow));

    expect(diagram.nodes.map((n) => n.id)).toEqual(["a", "b", "c"]);
    expect(diagram.edges).toEqual(flow.edges);
  });

  it("unwraps a fenced block", () => {
    const raw = "```json\n" + JSON.stringify(flow) + "\n```";

    expect(parseDiagramPayload(raw).nodes).toHaveLength(3);
  });

  it("ignores prose before and after the object", () => {
    const raw = `Here is your diagram:\n${JSON.stringify(flow)}\nHope that helps!`;

    expect(parseDiagramPayload(raw).nodes).toHaveLength(3);
  });

  it("salvages a truncated payload by closing it", () => {
    const full = JSON.stringify(flow);
    const cut = full.slice(0, full.indexOf('"edges"') + 20);

    const diagram = parseDiagramPayload(cut);

    expect(diagram.nodes).toHaveLength(3);
    expect(diagram.edges).toEqual([]);
  });

  it("turns an unknown shape into a rectangle", () => {
    const diagram = parseDiagramPayload(
      JSON.stringify({ nodes: [{ id: "x", shape: "hexagon", label: "X" }] }),
    );

    expect(diagram.nodes[0]!.shape).toBe("rectangle");
  });

  it("drops edges that point at nodes that do not exist, and self-loops", () => {
    const diagram = parseDiagramPayload(
      JSON.stringify({
        ...flow,
        edges: [
          ...flow.edges,
          { from: "a", to: "ghost" },
          { from: "ghost", to: "a" },
          { from: "a", to: "a" },
          { from: "a", to: "b" },
        ],
      }),
    );

    expect(diagram.edges).toEqual(flow.edges);
  });

  it("keeps node ids unique when the model repeats one", () => {
    const diagram = parseDiagramPayload(
      JSON.stringify({
        nodes: [
          { id: "dup", label: "One" },
          { id: "dup", label: "Two" },
        ],
        edges: [],
      }),
    );

    const ids = diagram.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids[0]).toBe("dup");
  });

  it("applies an edge naming a repeated id to every node that claimed it", () => {
    const diagram = parseDiagramPayload(
      JSON.stringify({
        nodes: [
          { id: "dup", label: "One" },
          { id: "dup", label: "Two" },
          { id: "z", label: "Z" },
        ],
        edges: [{ from: "dup", to: "z" }],
      }),
    );

    expect(diagram.edges).toHaveLength(2);
  });

  it("reads a direction hint and ignores one it does not know", () => {
    const withDir = (direction: unknown) =>
      parseDiagramPayload(JSON.stringify({ ...flow, direction })).direction;

    expect(withDir("TB")).toBe("TB");
    expect(withDir("bt")).toBe("TB");
    expect(withDir("LR")).toBe("LR");
    expect(withDir("rl")).toBe("LR");
    expect(withDir("sideways")).toBeUndefined();
    expect(withDir(3)).toBeUndefined();
  });

  it("sizes nodes to their labels within the clamps", () => {
    const diagram = parseDiagramPayload(
      JSON.stringify({
        nodes: [
          { id: "s", label: "Hi" },
          { id: "l", label: "word ".repeat(60) },
        ],
      }),
    );

    expect(diagram.nodes[0]!.width).toBe(180);
    expect(diagram.nodes[1]!.width).toBeLessThanOrEqual(360);
    expect(diagram.nodes[1]!.height).toBeGreaterThan(diagram.nodes[0]!.height);
  });

  it("rejects text with no JSON, naming a preview", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => parseDiagramPayload("I cannot do that")).toThrow(
      /invalid JSON/,
    );
    expect(spy).toHaveBeenCalled();
  });

  it("rejects a payload with no nodes", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => parseDiagramPayload('{"nodes":[],"edges":[]}')).toThrow(
      /at least one node/,
    );
  });

  it("rejects a non-object node", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => parseDiagramPayload('{"nodes":[7]}')).toThrow(/Invalid node/);
  });
});

describe("validation defaults", () => {
  const parseNode = (over: Record<string, unknown>) =>
    parseDiagramPayload(
      JSON.stringify({ nodes: [{ id: "n", label: "L", ...over }] }),
    ).nodes[0]!;

  it("keeps position hints, including numeric strings", () => {
    const node = parseNode({ x: "120", y: 40 });

    expect([node.x, node.y]).toEqual([120, 40]);
  });

  it.each([null, "", true, {}, [], "abc"])(
    "falls back to the grid position for the unusable hint %j",
    (hint) => {
      const node = parseNode({ x: hint, y: hint });

      expect([node.x, node.y]).toEqual([80, 80]);
    },
  );

  it("names a node that has no usable id or label", () => {
    const diagram = parseDiagramPayload(
      JSON.stringify({ nodes: [{ id: "  ", label: 7 }, { label: "second" }] }),
    );

    expect(diagram.nodes.map((n) => n.id)).toEqual(["node_1", "node_2"]);
    expect(diagram.nodes[0]!.label).toBe("Step 1");
  });

  it("trims ids and labels", () => {
    const node = parseNode({ id: "  spaced  ", label: "  padded  " });

    expect([node.id, node.label]).toEqual(["spaced", "padded"]);
  });

  it("keeps colours the model gave and replaces ones it did not", () => {
    const given = parseNode({
      backgroundColor: "#ff0000",
      strokeColor: "#00ff00",
    });
    expect([given.backgroundColor, given.strokeColor]).toEqual([
      "#ff0000",
      "#00ff00",
    ]);

    const missing = parseNode({ backgroundColor: 4, strokeColor: null });
    expect(missing.backgroundColor).toMatch(/^#/);
    expect(missing.strokeColor).toBe("#1e1e1e");
  });

  it("treats a non-string shape as a rectangle", () => {
    expect(parseNode({ shape: 5 }).shape).toBe("rectangle");
  });

  it("gives an empty label a one-line node", () => {
    const node = parseNode({ label: "" });

    expect(node.label).toBe(" ");
    expect(node.height).toBe(88);
  });

  it("skips blank lines inside a label", () => {
    expect(parseNode({ label: "a\n\n  \nb" }).label).toBe("a\nb");
  });

  it("ignores edges that are not a list, not objects or not named", () => {
    const base = { nodes: [{ id: "a" }, { id: "b" }] };

    expect(
      parseDiagramPayload(JSON.stringify({ ...base, edges: "a->b" })).edges,
    ).toEqual([]);
    expect(
      parseDiagramPayload(
        JSON.stringify({
          ...base,
          edges: [
            null,
            3,
            { from: 1, to: "b" },
            { from: "a" },
            { from: "a", to: "b" },
          ],
        }),
      ).edges,
    ).toEqual([{ from: "a", to: "b" }]);
  });

  it.each(["null", "42", '"text"'])(
    "reports %s as invalid JSON without a validator complaint",
    (raw) => {
      vi.spyOn(console, "error").mockImplementation(() => {});

      expect(() => parseDiagramPayload(raw)).toThrow(/invalid JSON/);
    },
  );

  it("reports an array payload as having no nodes", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => parseDiagramPayload("[1,2]")).toThrow(/at least one node/);
  });

  it("reports an empty payload without a preview", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => parseDiagramPayload("")).toThrow(
      /^Canvas model returned invalid JSON$/,
    );
  });
});

describe("escapes and long words", () => {
  const withEscapes = String.raw`{"nodes":[{"id":"a","label":"say \"hi\" in C:\\dir"},{"id":"b","label":"next"}]}`;

  it("reads a label containing escaped quotes and backslashes", () => {
    const diagram = parseDiagramPayload(`Sure:\n${withEscapes}\nDone.`);

    expect(diagram.nodes[0]!.label).toBe('say "hi" in C:\\dir');
  });

  it("salvages a truncated payload that contains escapes", () => {
    const cut = withEscapes.slice(0, withEscapes.indexOf('"next"') + 3);

    const diagram = parseDiagramPayload(cut);

    expect(diagram.nodes.map((n) => n.id)).toEqual(["a"]);
  });

  it("gives up when closing the payload still would not parse", () => {
    expect(extractJsonObject('{"a" 1')).toBeNull();
  });

  it("splits a word longer than a line and keeps the pieces on separate lines", () => {
    const diagram = parseDiagramPayload(
      JSON.stringify({ nodes: [{ id: "x", label: "z".repeat(100) }] }),
    );

    const lines = diagram.nodes[0]!.label.split("\n");
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.join("")).toBe("z".repeat(100));
  });

  it("flushes the line in progress before an overlong word", () => {
    const diagram = parseDiagramPayload(
      JSON.stringify({
        nodes: [{ id: "x", label: `short ${"w".repeat(60)}` }],
      }),
    );

    expect(diagram.nodes[0]!.label.split("\n")[0]).toBe("short");
  });
});

describe("extractJsonObject", () => {
  it("returns null when there is no object", () => {
    expect(extractJsonObject("nothing here")).toBeNull();
  });

  it("is not fooled by braces inside strings", () => {
    const raw = 'x {"label":"a } b","n":1} y';

    expect(extractJsonObject(raw)).toBe('{"label":"a } b","n":1}');
  });

  it("gives up on a truncated payload it cannot repair", () => {
    expect(extractJsonObject('{"a": ]')).toBeNull();
  });
});
