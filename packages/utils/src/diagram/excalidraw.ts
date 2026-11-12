/**
 * @module utils/diagram/excalidraw
 * @description Converts a laid-out {@link Diagram} into Excalidraw elements:
 * a shape plus bound text per node and one elbowed, bound arrow per edge.
 *
 * Label text elements are sized from the same measurement the node sizing
 * used (`measure.ts`), centered in the shape's text area, so a label fills its
 * box exactly as the layout planned. When the layout supplied routes, each
 * arrow follows its route's bend points and its bindings are derived from where
 * that route meets the boxes; without routes (fallback layout) arrows are
 * straight connectors between the facing box sides.
 *
 * @important Element ids, seeds and timestamps come from an injectable source
 *            ({@link ExcalidrawBuildOptions}); the defaults use `Math.random`
 *            and `Date.now`, so deterministic output is opt-in.
 */
import type { DiagramEdge, DiagramNode } from "@nimbus/types";
import type { DiagramPoint, LaidOutDiagram } from "./layout";
import { measureLabel } from "./measure";
import {
  LABEL_FONT_FAMILY,
  LABEL_FONT_SIZE,
  LABEL_LINE_HEIGHT,
  labelArea,
} from "./parse";

/** Minimal live-shape view used for center/binding calculations. */
type ExcalidrawShape = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  strokeColor: string;
  boundElements: { id: string; type: "text" | "arrow" }[] | null;
};

/**
 * Generates a 10-char Excalidraw-compatible element id.
 *
 * `toString(36)` emits as many digits as the value needs, so the slice is
 * occasionally only 9 characters (~0.74% of draws). Padding rather than
 * redrawing keeps the id shape — lowercase alphanumeric, fixed width — that
 * everything downstream already assumes; the entropy lost is irrelevant for an
 * element identifier.
 */
export function generateExcalidrawId(random: () => number = Math.random) {
  return random().toString(36).substring(2, 12).padEnd(10, "0");
}

/**
 * Sources of nondeterminism in the element builder. Every field defaults to the
 * real thing; tests inject fixed ones to get byte-stable output.
 */
export type ExcalidrawBuildOptions = {
  /** Produces each element id. */
  generateId?: () => string;
  /** Uniform draw in [0, 1) behind seeds and version nonces. */
  random?: () => number;
  /** Millisecond timestamp stamped on every element. */
  now?: () => number;
};

type BuildSource = Required<ExcalidrawBuildOptions>;
/* ═══ Excalidraw element builders ═══ */
/** Shared Excalidraw defaults (seeded randomness, solid fill, v1 versioning). */
function baseFields(
  type: string,
  index: string,
  strokeColor: string,
  source: BuildSource,
) {
  const seed = Math.floor(source.random() * 2e9);
  const versionNonce = Math.floor(source.random() * 2e9);
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
    updated: source.now(),
    link: null,
    locked: false,
  };
}

/** Builds the shape element for a node (text + arrows bound later). */
function buildShapeElement(
  node: DiagramNode,
  index: string,
  source: BuildSource,
) {
  const id = source.generateId();
  return {
    ...baseFields(node.shape, index, node.strokeColor ?? "#1e1e1e", source),
    id,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    backgroundColor: node.backgroundColor ?? "#e8f0fe",
    boundElements: null as { id: string; type: "text" | "arrow" }[] | null,
  };
}

/**
 * Builds the center-aligned bound text and links it onto the shape's
 * `boundElements` so Excalidraw treats it as container text. Width is the
 * shape's text area; height is the measured label height; the element is
 * centered on the shape.
 */
function buildBoundTextElement(
  shape: ExcalidrawShape,
  node: DiagramNode,
  index: string,
  source: BuildSource,
) {
  const textId = source.generateId();
  const area = labelArea(node.shape, shape.width, shape.height);
  const measured = measureLabel(node.label, {
    fontSize: LABEL_FONT_SIZE,
    lineHeight: LABEL_LINE_HEIGHT,
    maxWidth: Infinity,
  });
  const width = area.width;
  const height = measured.height;

  const textEl = {
    ...baseFields("text", index, shape.strokeColor, source),
    id: textId,
    x: shape.x + (shape.width - width) / 2,
    y: shape.y + (shape.height - height) / 2,
    width,
    height,
    backgroundColor: "transparent",
    boundElements: null,
    text: node.label,
    fontSize: LABEL_FONT_SIZE,
    fontFamily: LABEL_FONT_FAMILY,
    textAlign: "center",
    verticalAlign: "middle",
    containerId: shape.id,
    originalText: node.label,
    autoResize: false,
    lineHeight: LABEL_LINE_HEIGHT,
  };

  shape.boundElements = [{ id: textId, type: "text" }];
  return textEl;
}

/** Center point of a shape, used as the arrow-aim reference. */
function shapeCenter(shape: ExcalidrawShape) {
  return { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
}

/* ═══ Arrow binding math ═══ */
/**
 * Picks the shape edge facing `toward`, spreading multi-edges along it.
 * Normalized 0–1 fixed point for Excalidraw elbow bindings: dominant axis
 * decides the side, `slotIndex/slotCount` fans parallel arrows (0.2–0.8).
 */
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

/** Converts a normalized fixed point to canvas coordinates. */
function fixedPointToGlobal(
  shape: ExcalidrawShape,
  fixedPoint: [number, number],
) {
  return {
    x: shape.x + fixedPoint[0] * shape.width,
    y: shape.y + fixedPoint[1] * shape.height,
  };
}

/** Registers an arrow id on a shape so selection/deletion stays linked. */
function addArrowBinding(shape: ExcalidrawShape, arrowId: string) {
  // A shape is given its bound text before any arrow reaches it.
  shape.boundElements = [
    ...shape.boundElements!,
    { id: arrowId, type: "arrow" },
  ];
}

/**
 * Builds an elbowed arrow between two shapes with start/end bindings.
 * Points are stored relative to the start anchor; width/height are clamped
 * to ≥1px so zero-length connectors never produce degenerate elements.
 */
function buildConnector(
  fromShape: ExcalidrawShape,
  toShape: ExcalidrawShape,
  index: string,
  source: BuildSource,
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

  const arrowId = source.generateId();
  const arrow = {
    ...baseFields("arrow", index, "#1e1e1e", source),
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
/** Normalized 0–1 position of a canvas point within a shape's box. */
function pointToFixed(
  shape: ExcalidrawShape,
  point: DiagramPoint,
): [number, number] {
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return [
    clamp((point.x - shape.x) / shape.width),
    clamp((point.y - shape.y) / shape.height),
  ];
}

/**
 * Builds an elbowed arrow that follows a routed polyline. The first point is
 * the arrow's origin and the rest are stored relative to it; the bindings'
 * fixed points are where the route meets each box, so the arrow keeps the same
 * attachment when a box is moved.
 */
function buildRoutedConnector(
  fromShape: ExcalidrawShape,
  toShape: ExcalidrawShape,
  route: DiagramPoint[],
  index: string,
  source: BuildSource,
) {
  const origin = route[0]!;
  const points = route.map(
    (p) => [p.x - origin.x, p.y - origin.y] as [number, number],
  );
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);

  const arrowId = source.generateId();
  const arrow = {
    ...baseFields("arrow", index, "#1e1e1e", source),
    id: arrowId,
    x: origin.x,
    y: origin.y,
    width: Math.max(1, Math.max(...xs) - Math.min(...xs)),
    height: Math.max(1, Math.max(...ys) - Math.min(...ys)),
    backgroundColor: "transparent",
    boundElements: null,
    elbowed: true,
    lastCommittedPoint: null,
    fixedSegments: null,
    startIsSpecial: null,
    endIsSpecial: null,
    points,
    endArrowhead: "arrow",
    startArrowhead: null,
    startBinding: {
      elementId: fromShape.id,
      focus: 0,
      gap: 8,
      fixedPoint: pointToFixed(fromShape, route[0]!),
    },
    endBinding: {
      elementId: toShape.id,
      focus: 0,
      gap: 8,
      fixedPoint: pointToFixed(toShape, route[route.length - 1]!),
    },
  };

  addArrowBinding(fromShape, arrowId);
  addArrowBinding(toShape, arrowId);

  return arrow;
}

/**
 * Emits Excalidraw elements: shape + bound text per node, then one elbowed
 * connector per edge — following the layout's route when it has one, otherwise
 * a straight connector (parallel edges fanned via slot indices). Skips edges
 * whose endpoints vanished during validation.
 */
export function buildExcalidrawFromDiagram(
  diagram: LaidOutDiagram,
  options: ExcalidrawBuildOptions = {},
) {
  const random = options.random ?? Math.random;
  const source: BuildSource = {
    random,
    generateId: options.generateId ?? (() => generateExcalidrawId(random)),
    now: options.now ?? Date.now,
  };
  const output: Record<string, unknown>[] = [];
  const shapeByNodeId = new Map<string, ExcalidrawShape>();
  let indexCounter = 0;
  const nextIndex = () => `a${indexCounter++}`;

  for (const node of diagram.nodes) {
    const shape = buildShapeElement(node, nextIndex(), source);
    const text = buildBoundTextElement(shape, node, nextIndex(), source);
    shapeByNodeId.set(node.id, shape);
    output.push(shape, text);
  }

  const edgesByFrom = new Map<string, DiagramEdge[]>();
  for (const edge of diagram.edges) {
    const list = edgesByFrom.get(edge.from) ?? [];
    list.push(edge);
    edgesByFrom.set(edge.from, list);
  }

  for (const [edgeIndex, edge] of diagram.edges.entries()) {
    const fromShape = shapeByNodeId.get(edge.from);
    const toShape = shapeByNodeId.get(edge.to);
    if (!fromShape || !toShape) continue;
    const route = diagram.routes?.[edgeIndex];
    if (route && route.length >= 2) {
      output.push(
        buildRoutedConnector(fromShape, toShape, route, nextIndex(), source),
      );
      continue;
    }
    // Grouped from the same list, so the source always has an entry.
    const siblings = edgesByFrom.get(edge.from)!;
    const slotIndex = siblings.indexOf(edge);
    output.push(
      buildConnector(
        fromShape,
        toShape,
        nextIndex(),
        source,
        slotIndex,
        siblings.length,
      ),
    );
  }

  return output;
}
