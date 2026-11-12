/**
 * @module utils/diagram/layout
 * @description Placement and edge routing for a {@link Diagram}.
 *
 * Diagrams with edges go through ELK's `layered` algorithm (Sugiyama-style):
 * layer-sweep crossing minimisation, node-size-aware spacing and orthogonal
 * edge routing. The nodes arrive already sized from measured labels, so the
 * planned boxes are the boxes that get drawn. ELK's edge sections come back as
 * polylines in {@link LaidOutDiagram.routes} for the element builder to draw.
 * Edgeless diagrams get a grid whose columns and rows are sized from the nodes
 * themselves, so no cell can be overrun.
 *
 * Node coordinates are mutated in place; the returned object is the same
 * diagram, with `routes` attached. Same input, same output: ELK is
 * deterministic given fixed options and a fixed random seed, and nodes and
 * edges are fed to it in the diagram's own order.
 *
 * @important Layout must never fail generation. ELK is loaded lazily (keeping
 *            it out of bundles that only import the barrel), is capped by a
 *            size limit and a time budget, and any error, timeout or invalid
 *            result falls back to the synchronous rank-based layout in
 *            `layoutFallback.ts`, which leaves `routes` unset so the builder
 *            draws straight connectors. The time budget bounds how long the
 *            caller waits on a stalled run; ELK itself runs on the calling
 *            thread, so the size limit is what bounds its blocking time.
 */
import type { Diagram, DiagramDirection, DiagramNode } from "@nimbus/types";
import type { ELK, ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api";
import { layoutDiagramFallback, rectsOverlap } from "./layoutFallback";

export { layoutDiagramFallback, rectsOverlap };

/** A point on the canvas. */
export type DiagramPoint = { x: number; y: number };

/**
 * A diagram after layout. `routes[i]` is the polyline for `edges[i]`, from the
 * source box border to the target box border, or `null` when that edge was not
 * routed. `routes` is absent when the fallback layout ran.
 */
export type LaidOutDiagram = Diagram & {
  routes?: (DiagramPoint[] | null)[];
};

/** Tuning knobs for {@link layoutDiagram}. */
export type LayoutOptions = {
  /** Overrides the diagram's own direction; `LR` when neither is set. */
  direction?: DiagramDirection;
  /** ELK time budget in ms before the fallback takes over. Default 2000. */
  timeoutMs?: number;
  /** Largest node count handed to ELK; bigger diagrams use the fallback. */
  maxElkNodes?: number;
};

const LAYOUT_START_X = 80;
const LAYOUT_START_Y = 80;
const DEFAULT_TIMEOUT_MS = 2000;
const DEFAULT_MAX_ELK_NODES = 400;
const GRID_GAP_X = 80;
const GRID_GAP_Y = 70;

/** Fixed ELK options. Changing any of them changes every generated layout. */
const ELK_OPTIONS: Record<string, string> = {
  "elk.algorithm": "layered",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.padding": "[top=0,left=0,bottom=0,right=0]",
  "elk.randomSeed": "1",
  "elk.separateConnectedComponents": "true",
  "elk.spacing.componentComponent": "70",
  "elk.spacing.nodeNode": "56",
  "elk.spacing.edgeNode": "28",
  "elk.spacing.edgeEdge": "16",
  "elk.layered.spacing.nodeNodeBetweenLayers": "96",
  "elk.layered.spacing.edgeNodeBetweenLayers": "28",
  "elk.layered.spacing.edgeEdgeBetweenLayers": "16",
  "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
  "elk.layered.thoroughness": "8",
  "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
  "elk.layered.cycleBreaking.strategy": "GREEDY_MODEL_ORDER",
  "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
};

/** Grid for edgeless diagrams: columns and rows are as big as their largest node. */
function measuredGrid(nodes: DiagramNode[]) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
  const rows = Math.ceil(nodes.length / cols);
  const colWidth = new Array<number>(cols).fill(0);
  const rowHeight = new Array<number>(rows).fill(0);

  nodes.forEach((node, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    colWidth[c] = Math.max(colWidth[c]!, node.width);
    rowHeight[r] = Math.max(rowHeight[r]!, node.height);
  });

  const colX: number[] = [];
  let x = LAYOUT_START_X;
  for (const w of colWidth) {
    colX.push(x);
    x += w + GRID_GAP_X;
  }
  const rowY: number[] = [];
  let y = LAYOUT_START_Y;
  for (const h of rowHeight) {
    rowY.push(y);
    y += h + GRID_GAP_Y;
  }

  nodes.forEach((node, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    node.x = colX[c]! + (colWidth[c]! - node.width) / 2;
    node.y = rowY[r]! + (rowHeight[r]! - node.height) / 2;
  });
}

/** Loads the ELK constructor on first use. */
async function loadElk(): Promise<new () => ELK> {
  const mod = (await import("elkjs/lib/elk.bundled.js")) as unknown as {
    default: unknown;
  };
  const candidate = mod.default as { default?: unknown };
  return (candidate.default ?? candidate) as new () => ELK;
}

/** Runs ELK on `graph`, rejecting if it exceeds `timeoutMs`. */
async function runElk(graph: ElkNode, timeoutMs: number): Promise<ElkNode> {
  const Elk = await loadElk();
  const elk = new Elk();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`ELK exceeded its ${timeoutMs}ms budget`)),
      timeoutMs,
    );
  });

  try {
    return await Promise.race([elk.layout(graph), budget]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Moves an end point that sits on a node's bounding-box side onto the shape's
 * real outline, along the direction the edge arrives from. ELK treats every
 * node as its bounding rectangle; ellipses and diamonds are narrower than that
 * away from the side's midpoint, so an unadjusted arrow would stop short.
 */
function snapToOutline(point: DiagramPoint, node: DiagramNode): DiagramPoint {
  if (node.shape === "rectangle") return point;

  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  const hw = node.width / 2;
  const hh = node.height / 2;
  const onVerticalSide =
    Math.abs(point.x - cx) / hw > Math.abs(point.y - cy) / hh;

  const reach = (ratio: number) => {
    const r = Math.min(Math.abs(ratio), 0.98);
    return node.shape === "ellipse" ? Math.sqrt(1 - r * r) : 1 - r;
  };

  if (onVerticalSide) {
    const dx = Math.sign(point.x - cx) * hw * reach((point.y - cy) / hh);
    return { x: cx + dx, y: point.y };
  }
  const dy = Math.sign(point.y - cy) * hh * reach((point.x - cx) / hw);
  return { x: point.x, y: cy + dy };
}

function isFinitePoint(p: DiagramPoint | undefined): p is DiagramPoint {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

/**
 * Lays the diagram out with ELK and returns positions plus routes without
 * touching the diagram, so a failure part-way leaves it unmodified.
 */
async function elkLayout(
  diagram: Diagram,
  direction: DiagramDirection,
  timeoutMs: number,
) {
  const { nodes, edges } = diagram;
  const known = new Set(nodes.map((n) => n.id));

  const elkEdges: ElkExtendedEdge[] = [];
  edges.forEach((edge, index) => {
    if (edge.from === edge.to || !known.has(edge.from) || !known.has(edge.to)) {
      return;
    }
    elkEdges.push({
      id: `e${index}`,
      sources: [edge.from],
      targets: [edge.to],
    });
  });

  const graph: ElkNode = {
    id: "root",
    layoutOptions: {
      ...ELK_OPTIONS,
      "elk.direction": direction === "TB" ? "DOWN" : "RIGHT",
    },
    children: nodes.map((n) => ({
      id: n.id,
      width: n.width,
      height: n.height,
    })),
    edges: elkEdges,
  };

  const result = await runElk(graph, timeoutMs);

  const placed = new Map<string, DiagramPoint>();
  for (const child of result.children ?? []) {
    const p = { x: child.x ?? NaN, y: child.y ?? NaN };
    if (!isFinitePoint(p)) throw new Error(`ELK left ${child.id} unplaced`);
    placed.set(child.id, p);
  }
  if (placed.size !== nodes.length) {
    throw new Error("ELK dropped nodes from the layout");
  }

  const minX = Math.min(...[...placed.values()].map((p) => p.x));
  const minY = Math.min(...[...placed.values()].map((p) => p.y));
  const shiftX = LAYOUT_START_X - minX;
  const shiftY = LAYOUT_START_Y - minY;

  const positions = new Map<string, DiagramPoint>();
  for (const [id, p] of placed) {
    positions.set(id, { x: p.x + shiftX, y: p.y + shiftY });
  }

  const routes: (DiagramPoint[] | null)[] = edges.map(() => null);
  for (const edge of result.edges ?? []) {
    const section = (edge as ElkExtendedEdge).sections?.[0];
    if (!section) continue;
    const raw = [
      section.startPoint,
      ...(section.bendPoints ?? []),
      section.endPoint,
    ];
    if (!raw.every(isFinitePoint)) throw new Error("ELK returned a bad route");
    routes[Number(edge.id.slice(1))] = raw.map((p) => ({
      x: p.x + shiftX,
      y: p.y + shiftY,
    }));
  }

  return { positions, routes };
}

/**
 * Lays out a diagram: ELK layered flow with routed edges when it has edges, a
 * measured grid when it has none, the rank-based fallback if ELK is
 * unavailable. Mutates node coordinates in place and returns the same diagram.
 *
 * @param diagram - Validated diagram, nodes already sized to their labels.
 * @param options - Direction override and ELK limits.
 * @returns The diagram, with `routes` set when ELK produced the layout.
 */
export async function layoutDiagram(
  diagram: Diagram,
  options: LayoutOptions = {},
): Promise<LaidOutDiagram> {
  const result: LaidOutDiagram = diagram;
  result.routes = undefined;

  const { nodes, edges } = diagram;
  if (nodes.length === 0) return result;

  const direction = options.direction ?? diagram.direction ?? "LR";
  const ids = new Set(nodes.map((n) => n.id));
  const routable = edges.some(
    (e) => e.from !== e.to && ids.has(e.from) && ids.has(e.to),
  );

  if (!routable) {
    measuredGrid(nodes);
    return result;
  }

  try {
    if (nodes.length > (options.maxElkNodes ?? DEFAULT_MAX_ELK_NODES)) {
      throw new Error(`${nodes.length} nodes exceeds the ELK size limit`);
    }
    const { positions, routes } = await elkLayout(
      diagram,
      direction,
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );

    for (const node of nodes) {
      const p = positions.get(node.id)!;
      node.x = p.x;
      node.y = p.y;
    }
    const byId = new Map(nodes.map((n) => [n.id, n]));
    result.routes = routes.map((route, i) => {
      if (!route) return null;
      const edge = edges[i]!;
      const first = snapToOutline(route[0]!, byId.get(edge.from)!);
      const last = snapToOutline(route[route.length - 1]!, byId.get(edge.to)!);
      return [first, ...route.slice(1, -1), last];
    });
  } catch (err) {
    console.warn(
      "[diagram] ELK layout unavailable, using fallback:",
      err instanceof Error ? err.message : err,
    );
    layoutDiagramFallback(diagram, direction);
  }

  return result;
}
