/**
 * @module api/__tests__/fixtures/canvasGeneration
 * @description Canned `{ nodes, edges }` payloads standing in for what the
 * canvas model returns. They are deliberately hand-written rather than captured
 * so each one isolates a single trait the pipeline has to survive: a clean flow,
 * a large branching flow, a payload cut off mid-token by the output cap, and
 * payloads with wrong-typed or dangling fields.
 *
 * Nothing here is a valid "expected output" — `canvasGeneration.ts` re-sizes,
 * re-positions and re-shapes everything it is given, so these fixtures only
 * describe model *input*.
 */

/** A node exactly as the model emits it: every field but `id` may be missing. */
export type RawNode = Record<string, unknown>;

/**
 * Model-facing payload. `nodes` is typed loosely on purpose — several fixtures
 * below exercise what happens when the model sends something other than an
 * array of objects.
 */
export type RawPayload = {
  nodes: unknown[];
  edges?: unknown[];
};

/**
 * Smallest useful flow: four nodes chained left to right with no branching.
 * All four sit on the same y hint, so the model's own placement cannot mask a
 * layout bug — any column offsets in the result come from `layoutDiagram`.
 */
export const simpleFlow: RawPayload = {
  nodes: [
    {
      id: "start",
      shape: "ellipse",
      label: "Request",
      x: 100,
      y: 100,
      backgroundColor: "#d3f9d8",
      strokeColor: "#1e1e1e",
    },
    { id: "validate", shape: "rectangle", label: "Validate", x: 300, y: 100 },
    { id: "decide", shape: "diamond", label: "Valid?", x: 500, y: 100 },
    { id: "persist", shape: "rectangle", label: "Persist", x: 700, y: 100 },
  ],
  edges: [
    { from: "start", to: "validate" },
    { from: "validate", to: "decide" },
    { from: "decide", to: "persist" },
  ],
};

/**
 * Larger flow with two fan-outs (`cache-hit` and `persist` each have two
 * outgoing edges) and a merge (`render` has two incoming edges). Fan-outs are
 * what force arrows to be spread along a shape edge instead of sharing one
 * anchor point, and the merge is the case where a target's arrows all arrive
 * from different sources.
 */
export const nestedFlow: RawPayload = {
  nodes: [
    { id: "intake", shape: "ellipse", label: "Intake" },
    { id: "auth", shape: "rectangle", label: "Authenticate" },
    { id: "load", shape: "rectangle", label: "Load record" },
    { id: "cache_hit", shape: "diamond", label: "Cache hit?" },
    { id: "cache_miss", shape: "rectangle", label: "Fetch upstream" },
    { id: "render", shape: "rectangle", label: "Render response" },
    { id: "persist", shape: "rectangle", label: "Persist result" },
    { id: "notify", shape: "ellipse", label: "Notify subscribers" },
    { id: "audit", shape: "rectangle", label: "Append audit log" },
  ],
  edges: [
    { from: "intake", to: "auth" },
    { from: "auth", to: "load" },
    { from: "load", to: "cache_hit" },
    { from: "cache_hit", to: "render" },
    { from: "cache_hit", to: "cache_miss" },
    { from: "cache_miss", to: "render" },
    { from: "render", to: "persist" },
    { from: "persist", to: "notify" },
    { from: "persist", to: "audit" },
  ],
};

/** A long label with no spaces, to exercise hard-splitting of overlong words. */
export const OVERLONG_WORD = "x".repeat(60);

/**
 * Same label on three different shapes, so the shape-type size multipliers can
 * be compared without any other variable changing. 16 characters is short
 * enough to stay on one line and long enough to clear `NODE_MIN_WIDTH`.
 */
export const SHARED_LABEL = "Ship the release";

export const shapeComparison: RawPayload = {
  nodes: [
    { id: "r", shape: "rectangle", label: SHARED_LABEL },
    { id: "e", shape: "ellipse", label: SHARED_LABEL },
    { id: "d", shape: "diamond", label: SHARED_LABEL },
  ],
};

/**
 * Cut off mid-token, as a stream that hit `max_output_tokens` would be: the
 * string literal for the third node's label is never closed and no bracket is
 * ever closed. This is the shape `trySalvageIncompleteJson` exists for.
 */
export const truncatedFlow = `{"nodes":[{"id":"ingest","shape":"rectangle","label":"Ingest"},{"id":"normalise","shape":"ellipse","label":"Normalise"},{"id":"quota","shape":"diamond","label":"Over quota`;

/** The same valid payload, but wrapped in the prose and fence the prompt forbids. */
export const proseWrapped = `Sure! Here is the diagram you asked for:
\`\`\`json
${JSON.stringify(simpleFlow)}
\`\`\`
Let me know if you want the edges labelled too.`;

/** Edges that must not become arrows: duplicates, self-loops, unknown ids, junk. */
export const danglingEdges: RawPayload = {
  nodes: [
    { id: "alpha", label: "Alpha" },
    { id: "beta", label: "Beta" },
  ],
  edges: [
    { from: "alpha", to: "beta" },
    { from: "alpha", to: "beta" },
    { from: "alpha", to: "alpha" },
    { from: "beta", to: "ghost" },
    { from: "ghost", to: "alpha" },
    { from: "", to: "beta" },
    { from: "alpha" },
    {},
    null,
    "alpha->beta",
  ],
};

/** Wrong-typed / missing node fields: every one of these has a documented default. */
export const unknownShapes: RawPayload = {
  nodes: [
    { id: "hex", shape: "hexagon", label: "Unsupported shape" },
    { id: "", shape: 42, label: "Numeric shape" },
    { shape: "diamond", label: "Missing id" },
    { id: "  padded  ", label: 99, backgroundColor: 7, strokeColor: null },
  ],
};

/**
 * Two nodes pointing at each other — a feedback loop, which is legal LLM output
 * (no rule in the prompt forbids it) and has no acyclic layering.
 */
export const cyclicFlow: RawPayload = {
  nodes: [
    { id: "worker", label: "Worker" },
    { id: "queue", label: "Queue" },
  ],
  edges: [
    { from: "worker", to: "queue" },
    { from: "queue", to: "worker" },
  ],
};

/**
 * Two nodes claiming the same logical id. The prompt asks for unique ids but
 * nothing enforces it, and `nodes` is not de-duplicated the way `edges` is.
 */
export const duplicateIds: RawPayload = {
  nodes: [
    { id: "entry", label: "Entry" },
    { id: "task", label: "First task" },
    { id: "task", label: "Second task" },
  ],
  edges: [{ from: "entry", to: "task" }],
};

/** A model that answered with prose and no JSON at all. */
export const proseOnly =
  "I can't draw that as a diagram because the request is ambiguous.";

/** Valid JSON, but not a diagram object — `{ nodes: [] }` and friends. */
export const emptyNodes: RawPayload = { nodes: [] };
export const nonObjectNodes: RawPayload = { nodes: [null, "cache"] };
