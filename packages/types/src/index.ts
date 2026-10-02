/**
 * @module types
 * @description Barrel export for `@nimbus/types`.
 *
 * Central home for shared Zod validation schemas, REST API DTOs, and the
 * typed Socket.IO event contracts used by both `apps/api` and `apps/web`.
 */

export {
  changePasswordSchema,
  deleteAccountSchema,
  profileSchema,
} from "./validations/account";
export {
  aiCredentialCreateSchema,
  aiFeatureSchema,
  aiPreferenceSchema,
  aiProviderIdSchema,
} from "./validations/ai";
export {
  CONTACT_CATEGORIES,
  CONTACT_CATEGORY_LABELS,
  contactSchema,
  type ContactCategory,
} from "./validations/contact";
export { documentSchema } from "./validations/document";
export { forgotSchema, loginSchema, resetSchema } from "./validations/login";
export { signupSchema } from "./validations/signup";
export { workspaceJoinSchema, workspaceSchema } from "./validations/workspace";

export { ServerResponse } from "./api/serverResponse";

export type {
  AiCredentialDTO,
  AiFeatureStatus,
  AiPreferenceDTO,
  AiStatusDTO,
} from "./api/ai";
export type { Message } from "./api/message";
export type { Member, Workspace } from "./api/workspaces";

export type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "./socket/socketEvents";

export type { VoiceUser } from "./socket/voice";

export type { BotResult } from "./api/bot";

export {
  AI_FEATURE_RECOMMENDED,
  AI_FEATURE_REQUIREMENTS,
  AI_PROVIDERS,
  AI_PROVIDER_IDS,
  meetsRequirements,
  modelById,
  modelsFor,
  type AiCapability,
  type AiEffort,
  type AiFeature,
  type AiModelSpec,
  type AiProviderId,
  type AiProviderSpec,
} from "./ai/providers";
