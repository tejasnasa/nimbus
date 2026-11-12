import type { Diagram, DiagramNode } from "@nimbus/types";
import type { DiagramPoint } from "../../src/diagram/layout";
import { parseDiagramRecord } from "../../src/diagram/parse";

type Spec = {
  nodes: (string | { id: string; label?: string; shape?: string })[];
  edges?: [string, string][];
  direction?: "LR" | "TB";
};

/** Builds a diagram through the real parser, so nodes are label-sized. */
export function makeDiagram(spec: Spec): Diagram {
  return parseDiagramRecord({
    nodes: spec.nodes.map((n) =>
      typeof n === "string" ? { id: n, label: n } : { label: n.id, ...n },
    ),
    edges: (spec.edges ?? []).map(([from, to]) => ({ from, to })),
    direction: spec.direction,
  });
}

/** Chain n0 -> n1 -> ... with short labels. */
export const chainSpec = (n: number): Spec => ({
  nodes: Array.from({ length: n }, (_, i) => ({
    id: `n${i}`,
    label: `Step ${i}`,
  })),
  edges: Array.from({ length: n - 1 }, (_, i) => [`n${i}`, `n${i + 1}`]),
});

/** AABB overlap with a minimum clear gap between the two rectangles. */
export function overlapsWithin(a: DiagramNode, b: DiagramNode, pad: number) {
  return (
    a.x < b.x + b.width + pad &&
    b.x < a.x + a.width + pad &&
    a.y < b.y + b.height + pad &&
    b.y < a.y + a.height + pad
  );
}

export function countOverlaps(nodes: DiagramNode[], pad = 0) {
  let count = 0;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (overlapsWithin(nodes[i]!, nodes[j]!, pad)) count++;
    }
  }
  return count;
}

/** True when the segment p to q passes through the interior of the rectangle. */
export function segmentCrossesRect(
  p: DiagramPoint,
  q: DiagramPoint,
  r: { x: number; y: number; width: number; height: number },
  shrink = 1,
) {
  const left = r.x + shrink;
  const right = r.x + r.width - shrink;
  const top = r.y + shrink;
  const bottom = r.y + r.height - shrink;
  let t0 = 0;
  let t1 = 1;
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const clip = (pk: number, qk: number) => {
    if (pk === 0) return qk >= 0;
    const t = qk / pk;
    if (pk < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  return (
    clip(-dx, p.x - left) &&
    clip(dx, right - p.x) &&
    clip(-dy, p.y - top) &&
    clip(dy, bottom - p.y) &&
    t0 < t1
  );
}

/** Number of (route segment, foreign node) pairs where a segment cuts a box. */
export function countRouteBoxHits(
  diagram: Diagram,
  routes: (DiagramPoint[] | null)[],
) {
  let hits = 0;
  diagram.edges.forEach((edge, i) => {
    const route = routes[i];
    if (!route) return;
    for (const node of diagram.nodes) {
      if (node.id === edge.from || node.id === edge.to) continue;
      for (let k = 0; k + 1 < route.length; k++) {
        if (segmentCrossesRect(route[k]!, route[k + 1]!, node)) hits++;
      }
    }
  });
  return hits;
}

/** Distance from a point to the border of a rectangle (0 when on it). */
export function distanceToBorder(p: DiagramPoint, r: DiagramNode) {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.width));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.height));
  if (dx > 0 || dy > 0) return Math.hypot(dx, dy);
  return Math.min(
    p.x - r.x,
    r.x + r.width - p.x,
    p.y - r.y,
    r.y + r.height - p.y,
  );
}
