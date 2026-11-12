/**
 * @module utils/diagram/layoutFallback
 * @description The dependency-free layout `layoutDiagram` falls back to when
 * ELK cannot be used: a rank-based layered flow for diagrams with edges and a
 * row-wrapped grid for edgeless ones.
 *
 * It places nodes on node-size-aware ranks but does no crossing minimisation
 * beyond a barycenter sweep and routes nothing, so edges are straight lines
 * between boxes. Mutates node coordinates in place. Pure: the same diagram
 * always lays out the same way.
 *
 * @important This is the safety net that keeps generation from failing on a
 *            layout error. Keep it synchronous and free of third-party code.
 */
import type {
  Diagram,
  DiagramDirection,
  DiagramEdge,
  DiagramNode,
} from "@nimbus/types";
import { NODE_MIN_HEIGHT, NODE_MIN_WIDTH } from "./parse";

/* ═══ Layout (rank-based flow, grid fallback) ═══ */
const LAYOUT_START_X = 80;
const LAYOUT_START_Y = 80;
const LAYOUT_H_GAP = 220;
const LAYOUT_V_GAP = 140;

/** AABB overlap test with padding. */
export function rectsOverlap(
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

/**
 * Longest-path layering: each node's rank = 1 + max(predecessor ranks).
 * Bellman-Ford-style relaxation tolerates cycles by settling instead of
 * looping forever.
 *
 * The pass count is the longest path a DAG can have, `n - 1`, rather than the
 * edge count: on a cycle the relaxation never converges, so a larger bound only
 * inflates the ranks further before giving up.
 */
function assignRanks(nodeIds: string[], edges: DiagramEdge[]) {
  const rank = new Map(nodeIds.map((id) => [id, 0]));
  const iterations = Math.max(nodeIds.length - 1, 0);

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

/**
 * Mean center of a node's already-placed predecessors along the cross axis,
 * for crossing reduction: each layer is ordered by it.
 */
function barycenter(
  nodeId: string,
  edges: DiagramEdge[],
  cross: Map<string, number>,
) {
  const neighbors = edges.filter((e) => e.to === nodeId).map((e) => e.from);

  if (neighbors.length === 0) return cross.get(nodeId) ?? 0;

  const sum = neighbors.reduce((acc, id) => acc + (cross.get(id) ?? 0), 0);
  return sum / neighbors.length;
}

/** Row-wrapped grid with fixed gaps for edgeless diagrams (√n columns). */
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

/**
 * Layered layout: ranks become columns (`LR`) or rows (`TB`), each layer is
 * barycenter-ordered along the cross axis and centered against the tallest
 * (or widest) layer. Wider layers get extra breathing room.
 *
 * Ranks are compressed onto consecutive layers first. A DAG's ranks are always
 * dense, so this is a no-op for the common case, but a cycle leaves gaps — and
 * a layer is allocated per integer rank, so even one gap pushes the whole
 * drawing off the visible canvas.
 */
function rankBasedLayout(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  direction: DiagramDirection,
) {
  const vertical = direction === "TB";
  const mainSize = (n: DiagramNode) => (vertical ? n.height : n.width);
  const crossSize = (n: DiagramNode) => (vertical ? n.width : n.height);
  const mainMin = vertical ? NODE_MIN_HEIGHT : NODE_MIN_WIDTH;
  const mainGap = vertical ? LAYOUT_V_GAP : LAYOUT_H_GAP;
  const place = (n: DiagramNode, main: number, cross: number) => {
    n.x = vertical ? cross : main;
    n.y = vertical ? main : cross;
  };

  const nodeIds = nodes.map((n) => n.id);
  const rank = assignRanks(nodeIds, edges);

  const usedRanks = [...new Set(rank.values())].sort((a, b) => a - b);
  const layerOfRank = new Map(usedRanks.map((r, layer) => [r, layer]));
  const layers: string[][] = Array.from({ length: usedRanks.length }, () => []);

  for (const id of nodeIds) {
    // Every id was ranked above, and every rank has a layer.
    layers[layerOfRank.get(rank.get(id)!)!]!.push(id);
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const crossCenter = new Map<string, number>();

  const maxLayerWidth = Math.max(...layers.map((l) => l.length), 1);
  const crossGap = vertical
    ? maxLayerWidth > 2
      ? 120
      : 80
    : maxLayerWidth > 2
      ? LAYOUT_V_GAP + 40
      : LAYOUT_V_GAP;

  let maxStack = 0;
  for (const layer of layers) {
    const h = layer.reduce(
      (sum, id) => sum + crossSize(byId.get(id)!) + crossGap,
      -crossGap,
    );
    maxStack = Math.max(maxStack, h);
  }

  let main = vertical ? LAYOUT_START_Y : LAYOUT_START_X;
  const crossStart = vertical ? LAYOUT_START_X : LAYOUT_START_Y;

  for (let r = 0; r < layers.length; r++) {
    const layer = layers[r]!;
    const ordered =
      r === 0
        ? [...layer].sort((a, b) => {
            const na = byId.get(a)!;
            const nb = byId.get(b)!;
            return vertical
              ? na.x - nb.x || na.y - nb.y
              : na.y - nb.y || na.x - nb.x;
          })
        : [...layer].sort(
            (a, b) =>
              barycenter(a, edges, crossCenter) -
              barycenter(b, edges, crossCenter),
          );

    const column = ordered.map((id) => byId.get(id)!).filter(Boolean);
    const layerExtent = Math.max(...column.map(mainSize), mainMin);
    const stack = column.reduce(
      (s, n) => s + crossSize(n) + crossGap,
      -crossGap,
    );
    let cross = crossStart + Math.max(0, (maxStack - stack) / 2);

    for (const node of column) {
      place(node, main, cross);
      crossCenter.set(node.id, cross + crossSize(node) / 2);
      cross += crossSize(node) + crossGap;
    }

    main += layerExtent + mainGap;
  }
}

/**
 * Lays a diagram out with the fallback algorithms: grid when edgeless,
 * rank-based flow otherwise. Mutates node coordinates in place.
 *
 * @param diagram - Validated diagram.
 * @param direction - Flow direction for the rank-based flow.
 * @returns The same diagram.
 */
export function layoutDiagramFallback(
  diagram: Diagram,
  direction: DiagramDirection = diagram.direction ?? "LR",
): Diagram {
  const { nodes, edges } = diagram;

  if (nodes.length === 0) return diagram;

  if (edges.length === 0) {
    gridLayout(nodes);
    return diagram;
  }

  rankBasedLayout(nodes, edges, direction);
  return diagram;
}
