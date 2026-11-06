/**
 * @module utils
 * @description Barrel export for `@nimbus/utils` — small shared helpers used
 * across the API and web apps.
 */

export {
  isOfferedFor,
  selectModelForFeature,
  type CredentialView,
  type FreeTierView,
  type PreferenceView,
  type SelectedModel,
  type SelectionRefusal,
} from "./ai/selectModel";
export { estimateCostUsd, type TokenUsage, type CostUsage } from "./ai/cost";
export { generateSlug } from "./slugGenerator";
export { timeAgo } from "./timeAgo";
export {
  extractJsonObject,
  parseDiagramPayload,
  parseDiagramRecord,
  PALETTE as DIAGRAM_PALETTE,
} from "./diagram/parse";
export { layoutDiagram } from "./diagram/layout";
export {
  buildExcalidrawFromDiagram,
  type ExcalidrawBuildOptions,
} from "./diagram/excalidraw";
