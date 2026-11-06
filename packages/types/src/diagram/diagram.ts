/**
 * @module types/diagram/diagram
 * @description Logical diagram model shared by the API's generation pipeline
 * and anything on the web that needs to name a diagram's parts.
 *
 * This is the validated intermediate form between model output and Excalidraw
 * elements: sized nodes plus referentially-safe edges.
 */

/** Flow direction the layout lays ranks out in. */
export type DiagramDirection = "LR" | "TB";

/** Logical node: x/y are hints — the layout pass overwrites them. */
export type DiagramNode = {
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

/** Logical connection between two node ids (the app draws the arrow). */
export type DiagramEdge = {
  from: string;
  to: string;
};

/** Validated model output: sized nodes plus deduped, referentially-safe edges. */
export type Diagram = {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  /** Flow direction hint; the layout uses `LR` when absent. */
  direction?: DiagramDirection;
};
