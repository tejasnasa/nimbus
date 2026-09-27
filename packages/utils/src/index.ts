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
export { generateSlug } from "./slugGenerator";
export { timeAgo } from "./timeAgo";
