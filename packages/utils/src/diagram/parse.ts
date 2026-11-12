/**
 * @module utils/diagram/parse
 * @description Tolerant parsing and validation of model-produced diagram JSON.
 *
 * Takes raw model text (fenced, wrapped in prose or truncated), recovers the
 * JSON object, validates it into a {@link Diagram} with safe defaults, and
 * sizes every node to its measured, wrapped label (see `measure.ts`: glyph
 * widths come from the label font's advance table, not a per-character guess).
 * Pure: no I/O, no environment reads.
 *
 * @important Node ids are made unique in {@link parseDiagramRecord}; the layout
 *            and element builders key every map by id and rely on that.
 */
import type {
  Diagram,
  DiagramDirection,
  DiagramEdge,
  DiagramNode,
} from "@nimbus/types";
import { measureLabel } from "./measure";

/* ═══ Label metrics & node sizing ═══
 * Labels are measured with the Virgil advance table in `measure.ts`;
 * `LABEL_FONT_FAMILY` is the Excalidraw id of that font. */
export const LABEL_FONT_SIZE = 16;
export const LABEL_LINE_HEIGHT = 1.35;
export const LABEL_FONT_FAMILY = 1;
export const NODE_H_PADDING = 44;
export const NODE_V_PADDING = 40;
export const NODE_MIN_WIDTH = 180;
export const NODE_MIN_HEIGHT = 88;
export const NODE_MAX_WIDTH = 360;

/** Shapes the LLM may request; anything else falls back to rectangle. */
export const SHAPE_TYPES = new Set(["rectangle", "ellipse", "diamond"]);
/** Soft fills cycled across nodes missing an explicit backgroundColor. */
export const PALETTE = [
  "#e3faf2",
  "#e8f0fe",
  "#fff3bf",
  "#ffe8cc",
  "#f3d9fa",
  "#d3f9d8",
];

/**
 * Coerces a numeric hint, falling back when the value is absent or unusable.
 *
 * Numeric strings are accepted (`"120"` → `120`) because the prompt asks the
 * model for coordinates and it frequently answers with strings. Values that
 * `Number()` maps to a finite `0` while meaning "no hint" — `null`, `""`,
 * booleans and arrays — fall back instead: reading one as `0` places the node
 * at the canvas origin deliberately, which reorders the first layout column
 * against the flow the model described.
 */
function numOrDefault(value: unknown, fallback: number) {
  if (value === null || value === "") return fallback;
  if (typeof value === "boolean" || typeof value === "object") return fallback;

  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Extracts the first balanced `{…}` object, tolerating fences and prose.
 *
 * Strips ```json fences, then brace-matches while respecting strings and
 * escapes. Falls back to `trySalvageIncompleteJson` for truncated streams.
 *
 * @param text - Raw model output.
 * @returns Balanced JSON substring, or null when none is recoverable.
 */
export function extractJsonObject(text: string): string | null {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fenced?.[1]?.trim() ?? trimmed;
  const start = source.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth++;
    if (char === "}") {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }

  return trySalvageIncompleteJson(source, start);
}

/**
 * Salvages truncated JSON by trimming the dangling tail and auto-closing
 * brackets. Guards against mismatched closers and re-validates with
 * `JSON.parse` before returning.
 */
function trySalvageIncompleteJson(
  source: string,
  start: number,
): string | null {
  let slice = source.slice(start).trimEnd();
  slice = slice.replace(/,\s*"[^"]*"?\s*:\s*("[^"]*)?$/, "");
  slice = slice.replace(/,\s*"[^"]*"?\s*:\s*[^,}\]]*$/, "");
  slice = slice.replace(/,\s*(\{[^{}]*|\[[^\]]*)?$/, "");
  slice = slice.replace(/,\s*$/, "");

  const toClose: string[] = [];
  let inString = false;
  let escaped = false;

  for (let i = 0; i < slice.length; i++) {
    const char = slice[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") toClose.push("}");
    if (char === "[") toClose.push("]");
    if (char === "}" || char === "]") {
      if (toClose.length === 0) return null;
      const expected = toClose[toClose.length - 1];
      if (char !== expected) return null;
      toClose.pop();
    }
  }

  while (toClose.length > 0) {
    slice += toClose.pop();
  }

  try {
    JSON.parse(slice);
    return slice;
  } catch {
    return null;
  }
}

/* ═══ Validation & label fitting ═══ */
/**
 * Validates raw nodes/edges into a `Diagram`, applying safe defaults.
 *
 * Unknown shapes → rectangle, missing ids/labels → generated, bad colors →
 * palette rotation, bad coords → grid fallback positions; edges referencing
 * missing ids, self-loops, or duplicates are dropped. Sizes via
 * `fitNodesToLabels`.
 *
 * @important Node ids are made unique here. The prompt asks the model for
 *            unique ids but nothing enforces it, and every map in the layout
 *            and element builders is keyed by id — so a repeat would leave one
 *            node unpositioned and bind its arrows to the other. A repeated id
 *            is read as the same logical node: later nodes are suffixed, and an
 *            edge naming that id is applied to every node that claimed it.
 *            This is the one place the uniqueness invariant can be established.
 */
export function parseDiagramRecord(record: {
  nodes?: unknown;
  edges?: unknown;
  direction?: unknown;
}): Diagram {
  if (!Array.isArray(record.nodes) || record.nodes.length === 0) {
    throw new Error("Canvas diagram must include at least one node");
  }

  const nodes: DiagramNode[] = record.nodes.map((node, index) => {
    if (!node || typeof node !== "object") {
      throw new Error(`Invalid node at index ${index}`);
    }
    const n = node as Record<string, unknown>;
    const shape =
      typeof n.shape === "string" && SHAPE_TYPES.has(n.shape)
        ? (n.shape as DiagramNode["shape"])
        : "rectangle";
    const id =
      typeof n.id === "string" && n.id.trim()
        ? n.id.trim()
        : `node_${index + 1}`;
    const label =
      typeof n.label === "string" ? n.label.trim() : `Step ${index + 1}`;

    return {
      id,
      shape,
      label,
      x: numOrDefault(n.x, 80 + (index % 4) * 280),
      y: numOrDefault(n.y, 80 + Math.floor(index / 4) * 160),
      width: NODE_MIN_WIDTH,
      height: NODE_MIN_HEIGHT,
      backgroundColor:
        typeof n.backgroundColor === "string"
          ? n.backgroundColor
          : PALETTE[index % PALETTE.length],
      strokeColor:
        typeof n.strokeColor === "string" ? n.strokeColor : "#1e1e1e",
    };
  });

  // Every original id is reserved before any alias is assigned, so an alias can
  // never steal the name of a node the model actually gave that id to.
  const reservedIds = new Set(nodes.map((n) => n.id));
  const assignedIds = new Set<string>();
  const aliasGroups = new Map<string, string[]>();

  for (const node of nodes) {
    const canonical = node.id;
    let unique = canonical;
    let suffix = 1;
    while (assignedIds.has(unique) || (suffix > 1 && reservedIds.has(unique))) {
      suffix += 1;
      unique = `${canonical}_${suffix}`;
    }
    assignedIds.add(unique);
    node.id = unique;

    const group = aliasGroups.get(canonical);
    if (group) group.push(unique);
    else aliasGroups.set(canonical, [unique]);
  }

  fitNodesToLabels(nodes);

  const seenEdges = new Set<string>();
  const edges: DiagramEdge[] = [];
  if (Array.isArray(record.edges)) {
    for (const edge of record.edges) {
      if (!edge || typeof edge !== "object") continue;
      const e = edge as Record<string, unknown>;
      const from = typeof e.from === "string" ? e.from.trim() : "";
      const to = typeof e.to === "string" ? e.to.trim() : "";
      if (!from || !to || from === to) continue;

      const fromIds = aliasGroups.get(from);
      const toIds = aliasGroups.get(to);
      if (!fromIds || !toIds) continue;

      for (const f of fromIds) {
        for (const t of toIds) {
          const key = `${f}->${t}`;
          if (f === t || seenEdges.has(key)) continue;
          seenEdges.add(key);
          edges.push({ from: f, to: t });
        }
      }
    }
  }

  const direction = parseDirection(record.direction);
  return direction ? { nodes, edges, direction } : { nodes, edges };
}

/** Reads a flow-direction hint, accepting the common spellings. */
function parseDirection(value: unknown): DiagramDirection | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim().toUpperCase();
  if (v === "LR" || v === "RL") return "LR";
  if (v === "TB" || v === "BT") return "TB";
  return undefined;
}

/**
 * Parses model output, trying the raw string then the extracted object.
 *
 * @param raw - Full model response text.
 * @returns Validated diagram.
 * @throws When neither candidate parses (logs a 160-char preview).
 */
export function parseDiagramPayload(raw: string): Diagram {
  const sources = [raw.trim()];
  const extracted = extractJsonObject(raw);
  if (extracted) sources.push(extracted);

  const errors: string[] = [];

  for (const candidate of sources) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (!parsed || typeof parsed !== "object") continue;
      return parseDiagramRecord(
        parsed as { nodes?: unknown; edges?: unknown; direction?: unknown },
      );
    } catch (err) {
      errors.push(err instanceof Error ? err.message : "parse failed");
    }
  }

  const preview = raw.trim().slice(0, 160).replace(/\s+/g, " ");
  console.error("[canvas] invalid JSON preview:", preview);

  // `errors` holds each candidate's real failure, which is usually the
  // validator's complaint rather than a syntax problem — a payload that parsed
  // perfectly and was rejected for having no nodes was previously reported as
  // unparseable, pointing debugging at the parser instead of the prompt.
  const detail = errors.length > 0 ? `: ${errors.slice(-1)[0]}` : "";

  throw new Error(
    `Canvas model returned invalid JSON${preview ? ` (${preview}…)` : ""}${detail}`,
  );
}

/**
 * How a shape's bounding box relates to the text rectangle it can hold.
 * `scale` is box size over text size: a rectangle holds text edge to edge, an
 * ellipse holds the rectangle inscribed in it (1/√2 of each side), a diamond
 * the one inscribed in it (1/2 of each side). `padX`/`padY` are the breathing
 * room around the text rectangle.
 */
const SHAPE_FIT = {
  rectangle: { scale: 1, padX: NODE_H_PADDING, padY: NODE_V_PADDING },
  ellipse: { scale: Math.SQRT2, padX: 24, padY: 16 },
  diamond: { scale: 2, padX: 24, padY: 16 },
} as const;

/** Inset (px) of a rectangle's label area from its border. */
const RECT_LABEL_INSET = 12;

/**
 * The rectangle a node's label may occupy: the text area inscribed in the
 * shape, centered on it. The Excalidraw text element is sized to this.
 *
 * @param shape - Node shape.
 * @param width - Node width.
 * @param height - Node height.
 * @returns Width and height of the label area.
 */
export function labelArea(
  shape: DiagramNode["shape"],
  width: number,
  height: number,
) {
  if (shape === "rectangle") {
    return {
      width: Math.max(24, width - RECT_LABEL_INSET * 2),
      height: Math.max(24, height - RECT_LABEL_INSET * 2),
    };
  }
  const { scale } = SHAPE_FIT[shape];
  return { width: width / scale, height: height / scale };
}

/**
 * Wraps each label to its shape's text width and sizes the node so the
 * measured label fits the shape's text area, clamped to min/max bounds.
 * Rewrites `node.label` with the wrap's line breaks.
 */
export function fitNodesToLabels(nodes: DiagramNode[]) {
  for (const node of nodes) {
    const fit = SHAPE_FIT[node.shape];
    const label = measureLabel(node.label, {
      fontSize: LABEL_FONT_SIZE,
      lineHeight: LABEL_LINE_HEIGHT,
      maxWidth: NODE_MAX_WIDTH / fit.scale - fit.padX - 1,
    });
    node.label = label.lines.join("\n");

    const width = Math.ceil((label.width + fit.padX) * fit.scale);
    const height = Math.ceil((label.height + fit.padY) * fit.scale);

    node.width = Math.min(NODE_MAX_WIDTH, Math.max(NODE_MIN_WIDTH, width));
    node.height = Math.max(NODE_MIN_HEIGHT, height);
  }
}
