import openaiClient from "./openaiClient";

const CANVAS_MAX_OUTPUT_TOKENS = 8_192;

const LABEL_FONT_SIZE = 16;
const LABEL_LINE_HEIGHT = 1.35;
const LABEL_CHAR_WIDTH = LABEL_FONT_SIZE * 0.68;
const NODE_H_PADDING = 44;
const NODE_V_PADDING = 40;
const NODE_MIN_WIDTH = 180;
const NODE_MIN_HEIGHT = 88;
const NODE_MAX_WIDTH = 360;

const SHAPE_TYPES = new Set(["rectangle", "ellipse", "diamond"]);
const PALETTE = [
  "#e3faf2",
  "#e8f0fe",
  "#fff3bf",
  "#ffe8cc",
  "#f3d9fa",
  "#d3f9d8",
];

type DiagramNode = {
  id: string;
  shape: "rectangle" | "ellipse" | "diamond";
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  backgroundColor?: string;
  strokeColor?: string;
};

type DiagramEdge = {
  from: string;
  to: string;
};

type Diagram = {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
};

type ExcalidrawShape = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  strokeColor: string;
  boundElements: { id: string; type: "text" | "arrow" }[] | null;
};

function generateExcalidrawId() {
  return Math.random().toString(36).substring(2, 12);
}

function numOrDefault(value: unknown, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function buildCanvasSystemPrompt(title: string) {
  return `You are an expert information architect creating Excalidraw-ready diagrams.

Title: "${title}"

Return a single JSON object with this exact structure:
{
  "nodes": [
    {
      "id": "unique_snake_case_id",
      "shape": "rectangle",
      "label": "Short label shown inside the shape",
      "x": 100,
      "y": 100,
      "width": 200,
      "height": 80,
      "backgroundColor": "#e8f0fe",
      "strokeColor": "#1e1e1e"
    }
  ],
  "edges": [
    { "from": "source_id", "to": "target_id" }
  ]
}

Rules:
- Output JSON only. No markdown. No commentary.
- Use 4–18 nodes depending on complexity.
- "shape" must be rectangle, ellipse, or diamond.
- Put ALL visible text in "label" on the node. Never emit separate text or arrow elements.
- "edges" lists logical connections only (from → to node ids). The app draws arrows.
- Box sizing is automatic from labels; omit width/height in JSON.
- Place each node with explicit x,y in a clear left-to-right flow (~280px horizontal gap, ~140px vertical gap between row centers).
- Align parallel branches on the same column x; stack branches vertically with even spacing.
- Keep labels concise; use "\\n" only when a line break is intentional.
- Use distinct soft background colors from: ${PALETTE.join(", ")}.
- strokeColor "#1e1e1e" unless a highlight needs another color.
- Every edge "from" and "to" must match an existing node "id".
- For branching flows, use multiple edges from one node to several targets.
- Coordinates: canvas origin top-left, x increases right, y increases down.`;
}

function extractJsonObject(text: string): string | null {
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

function parseDiagramRecord(record: {
  nodes?: unknown;
  edges?: unknown;
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

  fitNodesToLabels(nodes);

  const nodeIds = new Set(nodes.map((n) => n.id));
  const seenEdges = new Set<string>();
  const edges: DiagramEdge[] = Array.isArray(record.edges)
    ? record.edges
        .map((edge) => {
          if (!edge || typeof edge !== "object") return null;
          const e = edge as Record<string, unknown>;
          const from = typeof e.from === "string" ? e.from.trim() : "";
          const to = typeof e.to === "string" ? e.to.trim() : "";
          const key = `${from}->${to}`;
          if (
            !from ||
            !to ||
            !nodeIds.has(from) ||
            !nodeIds.has(to) ||
            from === to ||
            seenEdges.has(key)
          ) {
            return null;
          }
          seenEdges.add(key);
          return { from, to };
        })
        .filter((e): e is DiagramEdge => e !== null)
    : [];

  return { nodes, edges };
}

function parseDiagramPayload(raw: string): Diagram {
  const sources = [raw.trim()];
  const extracted = extractJsonObject(raw);
  if (extracted) sources.push(extracted);

  const errors: string[] = [];

  for (const candidate of sources) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (!parsed || typeof parsed !== "object") continue;
      return parseDiagramRecord(parsed as { nodes?: unknown; edges?: unknown });
    } catch (err) {
      errors.push(err instanceof Error ? err.message : "parse failed");
    }
  }

  const preview = raw.trim().slice(0, 160).replace(/\s+/g, " ");
  console.error("[canvas] invalid JSON preview:", preview);
  throw new Error(
    `Canvas model returned invalid JSON${preview ? ` (${preview}…)` : ""}`,
  );
}

function wrapLabelLines(label: string, maxCharsPerLine: number): string[] {
  const lines: string[] = [];

  for (const paragraph of label.split(/\n/)) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;

    let current = "";
    for (const word of words) {
      if (word.length > maxCharsPerLine) {
        if (current) {
          lines.push(current);
          current = "";
        }
        for (let i = 0; i < word.length; i += maxCharsPerLine) {
          lines.push(word.slice(i, i + maxCharsPerLine));
        }
        continue;
      }

      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length <= maxCharsPerLine) {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
  }

  return lines.length > 0 ? lines : [label.trim() || " "];
}

function fitNodesToLabels(nodes: DiagramNode[]) {
  const maxContentWidth = NODE_MAX_WIDTH - NODE_H_PADDING;
  const maxCharsPerLine = Math.max(
    14,
    Math.floor(maxContentWidth / LABEL_CHAR_WIDTH),
  );

  for (const node of nodes) {
    const lines = wrapLabelLines(node.label, maxCharsPerLine);
    node.label = lines.join("\n");

    const longestLine = Math.max(...lines.map((line) => line.length), 1);
    const contentWidth = longestLine * LABEL_CHAR_WIDTH;
    const contentHeight = lines.length * LABEL_FONT_SIZE * LABEL_LINE_HEIGHT;

    let width = Math.ceil(contentWidth + NODE_H_PADDING);
    let height = Math.ceil(contentHeight + NODE_V_PADDING);

    if (node.shape === "diamond") {
      width = Math.ceil(width * 1.2);
      height = Math.ceil(height * 1.15);
    } else if (node.shape === "ellipse") {
      width = Math.ceil(width * 1.08);
      height = Math.ceil(height * 1.08);
    }

    node.width = Math.min(NODE_MAX_WIDTH, Math.max(NODE_MIN_WIDTH, width));
    node.height = Math.max(NODE_MIN_HEIGHT, height);
  }
}

function baseFields(type: string, index: string, strokeColor: string) {
  const seed = Math.floor(Math.random() * 2e9);
  const versionNonce = Math.floor(Math.random() * 2e9);
  return {
    type,
    index,
    angle: 0,
    strokeColor,
    fillStyle: "solid" as const,
    strokeWidth: 1,
    strokeStyle: "solid" as const,
    roughness: 1,
    opacity: 100,
    groupIds: [] as string[],
    frameId: null,
    roundness: type === "rectangle" ? { type: 3 } : null,
    seed,
    version: 1,
    versionNonce,
    isDeleted: false,
    updated: Date.now(),
    link: null,
    locked: false,
  };
}

function buildShapeElement(node: DiagramNode, index: string) {
  const id = generateExcalidrawId();
  return {
    ...baseFields(node.shape, index, node.strokeColor ?? "#1e1e1e"),
    id,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    backgroundColor: node.backgroundColor ?? "#e8f0fe",
    boundElements: null as { id: string; type: "text" | "arrow" }[] | null,
  };
}

function buildBoundTextElement(
  shape: ExcalidrawShape,
  label: string,
  index: string,
) {
  const textId = generateExcalidrawId();
  const inset = 12;
  const width = Math.max(24, shape.width - inset * 2);
  const height = Math.max(24, shape.height - inset * 2);

  const textEl = {
    ...baseFields("text", index, shape.strokeColor),
    id: textId,
    x: shape.x + inset,
    y: shape.y + inset,
    width,
    height,
    backgroundColor: "transparent",
    boundElements: null,
    text: label,
    fontSize: LABEL_FONT_SIZE,
    fontFamily: 1,
    textAlign: "center",
    verticalAlign: "middle",
    containerId: shape.id,
    originalText: label,
    autoResize: false,
    lineHeight: LABEL_LINE_HEIGHT,
  };

  shape.boundElements = [{ id: textId, type: "text" }];
  return textEl;
}

function shapeCenter(shape: ExcalidrawShape) {
  return { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
}

/** Normalized attach point on shape bounds (0–1), used by Excalidraw elbow bindings. */
function bindingFixedPoint(
  shape: ExcalidrawShape,
  toward: { x: number; y: number },
  slotIndex: number,
  slotCount: number,
): [number, number] {
  const cx = shape.x + shape.width / 2;
  const cy = shape.y + shape.height / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  const along =
    slotCount <= 1 ? 0.5 : 0.2 + (slotIndex / (slotCount - 1)) * 0.6;

  if (Math.abs(dx) * shape.height > Math.abs(dy) * shape.width) {
    return dx > 0 ? [1, along] : [0, along];
  }
  return dy > 0 ? [along, 1] : [along, 0];
}

function fixedPointToGlobal(
  shape: ExcalidrawShape,
  fixedPoint: [number, number],
) {
  return {
    x: shape.x + fixedPoint[0] * shape.width,
    y: shape.y + fixedPoint[1] * shape.height,
  };
}

function addArrowBinding(shape: ExcalidrawShape, arrowId: string) {
  shape.boundElements = [
    ...(shape.boundElements ?? []),
    { id: arrowId, type: "arrow" },
  ];
}

function buildConnector(
  fromShape: ExcalidrawShape,
  toShape: ExcalidrawShape,
  index: string,
  slotIndex = 0,
  slotCount = 1,
) {
  const fromCenter = shapeCenter(fromShape);
  const toCenter = shapeCenter(toShape);
  const startFixed = bindingFixedPoint(
    fromShape,
    toCenter,
    slotIndex,
    slotCount,
  );
  const endFixed = bindingFixedPoint(toShape, fromCenter, slotIndex, slotCount);

  const startGlobal = fixedPointToGlobal(fromShape, startFixed);
  const endGlobal = fixedPointToGlobal(toShape, endFixed);
  const endLocalX = endGlobal.x - startGlobal.x;
  const endLocalY = endGlobal.y - startGlobal.y;

  const arrowId = generateExcalidrawId();
  const arrow = {
    ...baseFields("arrow", index, "#1e1e1e"),
    id: arrowId,
    x: startGlobal.x,
    y: startGlobal.y,
    width: Math.max(1, Math.abs(endLocalX)),
    height: Math.max(1, Math.abs(endLocalY)),
    backgroundColor: "transparent",
    boundElements: null,
    elbowed: true,
    lastCommittedPoint: null,
    fixedSegments: null,
    startIsSpecial: null,
    endIsSpecial: null,
    points: [
      [0, 0],
      [endLocalX, endLocalY],
    ] as [number, number][],
    endArrowhead: "arrow",
    startArrowhead: null,
    startBinding: {
      elementId: fromShape.id,
      focus: 0,
      gap: 8,
      fixedPoint: startFixed,
    },
    endBinding: {
      elementId: toShape.id,
      focus: 0,
      gap: 8,
      fixedPoint: endFixed,
    },
  };

  addArrowBinding(fromShape, arrowId);
  addArrowBinding(toShape, arrowId);

  return arrow;
}

const LAYOUT_START_X = 80;
const LAYOUT_START_Y = 80;
const LAYOUT_H_GAP = 220;
const LAYOUT_V_GAP = 140;

function rectsOverlap(
  a: DiagramNode,
  b: DiagramNode,
  padX: number,
  padY: number,
) {
  return (
    a.x < b.x + b.width + padX &&
    b.x < a.x + a.width + padX &&
    a.y < b.y + b.height + padY &&
    b.y < a.y + a.height + padY
  );
}

function assignRanks(nodeIds: string[], edges: DiagramEdge[]) {
  const rank = new Map(nodeIds.map((id) => [id, 0]));
  const iterations = Math.max(nodeIds.length, edges.length) + 1;

  for (let i = 0; i < iterations; i++) {
    let changed = false;
    for (const edge of edges) {
      const next = (rank.get(edge.from) ?? 0) + 1;
      if (next > (rank.get(edge.to) ?? 0)) {
        rank.set(edge.to, next);
        changed = true;
      }
    }
    if (!changed) break;
  }

  return rank;
}

function barycenterY(
  nodeId: string,
  edges: DiagramEdge[],
  centerY: Map<string, number>,
  incoming: boolean,
) {
  const neighbors = incoming
    ? edges.filter((e) => e.to === nodeId).map((e) => e.from)
    : edges.filter((e) => e.from === nodeId).map((e) => e.to);

  if (neighbors.length === 0) return centerY.get(nodeId) ?? 0;

  const sum = neighbors.reduce((acc, id) => acc + (centerY.get(id) ?? 0), 0);
  return sum / neighbors.length;
}

function gridLayout(nodes: DiagramNode[]) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
  let x = LAYOUT_START_X;
  let y = LAYOUT_START_Y;
  let col = 0;
  let rowMaxH = 0;
  let rowStartY = LAYOUT_START_Y;

  for (const node of nodes) {
    node.x = x;
    node.y = rowStartY;
    x += node.width + LAYOUT_H_GAP;
    rowMaxH = Math.max(rowMaxH, node.height);
    col++;

    if (col >= cols) {
      col = 0;
      x = LAYOUT_START_X;
      rowStartY += rowMaxH + LAYOUT_V_GAP;
      rowMaxH = 0;
    }
  }
}

function rankBasedLayout(nodes: DiagramNode[], edges: DiagramEdge[]) {
  const nodeIds = nodes.map((n) => n.id);
  const rank = assignRanks(nodeIds, edges);
  const maxRank = Math.max(...rank.values(), 0);
  const layers: string[][] = Array.from({ length: maxRank + 1 }, () => []);

  for (const id of nodeIds) {
    layers[rank.get(id) ?? 0]!.push(id);
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const centerY = new Map<string, number>();

  const maxLayerWidth = Math.max(...layers.map((l) => l.length), 1);
  const layerVGap = maxLayerWidth > 2 ? LAYOUT_V_GAP + 40 : LAYOUT_V_GAP;

  let maxColumnHeight = 0;
  for (const layer of layers) {
    const h = layer.reduce((sum, id) => {
      const n = byId.get(id);
      return n ? sum + n.height + layerVGap : sum;
    }, -layerVGap);
    maxColumnHeight = Math.max(maxColumnHeight, h);
  }

  let x = LAYOUT_START_X;

  for (let r = 0; r < layers.length; r++) {
    const layer = layers[r]!;
    const ordered =
      r === 0
        ? [...layer].sort((a, b) => {
            const na = byId.get(a)!;
            const nb = byId.get(b)!;
            return na.y - nb.y || na.x - nb.x;
          })
        : [...layer].sort(
            (a, b) =>
              barycenterY(a, edges, centerY, true) -
              barycenterY(b, edges, centerY, true),
          );

    const column = ordered.map((id) => byId.get(id)!).filter(Boolean);
    const colWidth = Math.max(...column.map((n) => n.width), NODE_MIN_WIDTH);
    const stackHeight = column.reduce(
      (s, n) => s + n.height + layerVGap,
      -layerVGap,
    );
    let y = LAYOUT_START_Y + Math.max(0, (maxColumnHeight - stackHeight) / 2);

    for (const node of column) {
      node.x = x;
      node.y = y;
      centerY.set(node.id, y + node.height / 2);
      y += node.height + layerVGap;
    }

    x += colWidth + LAYOUT_H_GAP;
  }
}

function layoutDiagram(diagram: Diagram): Diagram {
  const { nodes, edges } = diagram;

  if (nodes.length === 0) return diagram;

  if (edges.length === 0) {
    gridLayout(nodes);
    return diagram;
  }

  rankBasedLayout(nodes, edges);
  return diagram;
}

function buildExcalidrawFromDiagram(diagram: Diagram) {
  const output: Record<string, unknown>[] = [];
  const shapeByNodeId = new Map<string, ExcalidrawShape>();
  let indexCounter = 0;
  const nextIndex = () => `a${indexCounter++}`;

  for (const node of diagram.nodes) {
    const shape = buildShapeElement(node, nextIndex());
    const text = buildBoundTextElement(shape, node.label, nextIndex());
    shapeByNodeId.set(node.id, shape);
    output.push(shape, text);
  }

  const edgesByFrom = new Map<string, DiagramEdge[]>();
  for (const edge of diagram.edges) {
    const list = edgesByFrom.get(edge.from) ?? [];
    list.push(edge);
    edgesByFrom.set(edge.from, list);
  }

  for (const edge of diagram.edges) {
    const fromShape = shapeByNodeId.get(edge.from);
    const toShape = shapeByNodeId.get(edge.to);
    if (!fromShape || !toShape) continue;
    const siblings = edgesByFrom.get(edge.from) ?? [edge];
    const slotIndex = siblings.indexOf(edge);
    output.push(
      buildConnector(
        fromShape,
        toShape,
        nextIndex(),
        slotIndex,
        siblings.length,
      ),
    );
  }

  return output;
}

function extractResponseText(
  output: Array<{
    type: string;
    content?: Array<{ type: string; text?: string }>;
  }>,
) {
  for (const item of output) {
    if (item.type !== "message" || !item.content) continue;
    for (const part of item.content) {
      if (part.type === "output_text" && part.text) return part.text;
    }
  }
  return "";
}

export async function generateCanvasDocument(
  prompt: string,
  label: string,
  onReasoning: (token: string) => void = () => {},
  onStatus: (status: string) => void = () => {},
): Promise<{ canvasData: object[]; thinking: string }> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const model = process.env.OPENAI_MODEL!;
  const reasoningEffort = "low";
  let thinkingLog = "";

  const appendReasoning = (token: string) => {
    thinkingLog += token;
    onReasoning(token);
  };

  onStatus(`Planning diagram…`);

  const stream = await openaiClient.responses.create({
    model,
    stream: true,
    instructions: buildCanvasSystemPrompt(label),
    input: `Create a professional diagram as a JSON object for:\n${prompt}`,
    reasoning: {
      effort: reasoningEffort,
      summary: "detailed",
    },
    text: { format: { type: "json_object" } },
    max_output_tokens: CANVAS_MAX_OUTPUT_TOKENS,
  });

  let content = "";
  let completedOutput: Parameters<typeof extractResponseText>[0] | undefined;

  for await (const event of stream) {
    if (event.type === "response.reasoning_text.delta") {
      appendReasoning(event.delta);
      continue;
    }
    if (event.type === "response.reasoning_summary_text.delta") {
      appendReasoning(event.delta);
      continue;
    }
    if (event.type === "response.output_text.delta") {
      content += event.delta;
      continue;
    }
    if (event.type === "response.output_text.done" && event.text) {
      if (event.text.length >= content.length) {
        content = event.text;
      }
      continue;
    }
    if (event.type === "response.completed") {
      completedOutput = event.response.output;
      const fromResponse = extractResponseText(event.response.output);
      if (fromResponse.length >= content.length) {
        content = fromResponse;
      }
      const parsed = (event.response as { output_parsed?: unknown })
        .output_parsed;
      if (
        parsed &&
        typeof parsed === "object" &&
        Array.isArray((parsed as { nodes?: unknown }).nodes)
      ) {
        onStatus("Parsing diagram structure…");
        const diagram = parseDiagramRecord(
          parsed as { nodes?: unknown; edges?: unknown },
        );
        onStatus(
          `Layout — ${diagram.nodes.length} nodes, ${diagram.edges.length} edges`,
        );
        layoutDiagram(diagram);
        onStatus("Drawing shapes and connectors…");
        const canvasData = buildExcalidrawFromDiagram(diagram);
        if (canvasData.length === 0) {
          throw new Error("Canvas builder produced no elements");
        }
        onStatus(`Done — ${canvasData.length} canvas elements`);
        return { canvasData, thinking: thinkingLog };
      }
    }
  }

  if (!content.trim() && completedOutput) {
    content = extractResponseText(completedOutput);
  }

  if (!content.trim()) {
    throw new Error("OpenAI returned an empty canvas response");
  }

  onStatus("Parsing diagram structure…");
  let diagram: Diagram;
  try {
    diagram = parseDiagramPayload(content);
  } catch {
    const fallback = extractJsonObject(`${content}\n${thinkingLog}`);
    if (!fallback) throw new Error("Canvas model returned invalid JSON");
    diagram = parseDiagramPayload(fallback);
  }

  onStatus(
    `Layout — ${diagram.nodes.length} nodes, ${diagram.edges.length} edges`,
  );
  layoutDiagram(diagram);

  onStatus("Drawing shapes and connectors…");
  const canvasData = buildExcalidrawFromDiagram(diagram);

  if (canvasData.length === 0) {
    throw new Error("Canvas builder produced no elements");
  }

  onStatus(`Done — ${canvasData.length} canvas elements`);
  return { canvasData, thinking: thinkingLog };
}
