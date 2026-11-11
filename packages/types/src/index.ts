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
  agentStateSchema,
  endedSchema,
  redeemSchema,
  segmentsInSchema,
  usageInBodySchema,
} from "./validations/agent";
export {
  aiCallStatusSchema,
  aiCatalogQuerySchema,
  aiCredentialCreateSchema,
  aiFeatureSchema,
  aiModelProbeSchema,
  aiModelSourceSchema,
  aiPreferenceSchema,
  aiProviderIdSchema,
  aiSettingsSchema,
  aiUsageQuerySchema,
  aiWorkspaceParamsSchema,
} from "./validations/ai";
export {
  CONTACT_CATEGORIES,
  CONTACT_CATEGORY_LABELS,
  contactSchema,
  type ContactCategory,
} from "./validations/contact";
export {
  DOCUMENT_SEARCH_MAX,
  DOCUMENT_TITLE_MAX,
  documentRenameSchema,
  documentSchema,
  documentSearchQuerySchema,
} from "./validations/document";
export { forgotSchema, loginSchema, resetSchema } from "./validations/login";
export {
  chatImageSignatureQuerySchema,
  IMAGE_URL_MAX_LENGTH,
  MESSAGE_MAX_LENGTH,
  messageSendSchema,
} from "./validations/message";
export {
  ACTION_ITEM_PAGE_MAX,
  ACTION_ITEM_TEXT_MAX,
  actionItemListQuerySchema,
  actionItemPatchSchema,
  assistantStartSchema,
  captionLanguageSchema,
  liveMeetingQuerySchema,
  MEETING_PAGE_MAX,
  meetingListQuerySchema,
  meetingSearchQuerySchema,
  SEGMENT_PAGE_MAX,
  segmentsQuerySchema,
} from "./validations/meeting";
export {
  MEETING_ITEM_MAX,
  MEETING_SUMMARY_MAX,
  MEETING_TITLE_MAX,
  MeetingSummarySchema,
  type MeetingSummary,
} from "./validations/meetingSummary";
export { signupSchema } from "./validations/signup";
export { voiceTokenSchema } from "./validations/voice";
export {
  workspaceJoinSchema,
  workspaceMemberSchema,
  workspaceRoleSchema,
  workspaceSchema,
} from "./validations/workspace";

export { ServerResponse } from "./api/serverResponse";

export type {
  AiAdminWorkspaceDTO,
  AiCallDTO,
  AiCatalogDTO,
  AiCatalogModelDTO,
  AiCredentialDTO,
  AiCredentialSaveDTO,
  AiFeatureStatus,
  AiFreeAllowanceDTO,
  AiFreeState,
  AiFreeUsageDTO,
  AiPreferenceDTO,
  AiProbeResultDTO,
  AiUsageDTO,
  AiUsageFeatureTotal,
  AiVoiceUnavailableReason,
  AiWorkspaceSettingsDTO,
  AiWorkspaceStatusDTO,
} from "./api/ai";
export type {
  Diagram,
  DiagramDirection,
  DiagramEdge,
  DiagramNode,
} from "./diagram/diagram";
export type {
  AgentMember,
  AgentVoiceConfig,
  EndedRequest,
  RedeemRequest,
  RedeemResponse,
  SegmentIn,
  SegmentsRequest,
  SegmentsResponse,
  StateRequest,
  StopResponse,
  UsageIn,
  UsageRequest,
} from "./api/agent";
export { AGENT_WAKE_NAMES } from "./api/agent";
export type {
  ActionItemDTO,
  ActionItemListDTO,
  ActionItemsChangedDTO,
  ActionItemStatus,
  AssistantRefusalDTO,
  AssistantState,
  CatchUpDTO,
  DecisionDTO,
  LiveMeetingDTO,
  MeetingDetailDTO,
  MeetingParticipantDTO,
  SegmentSearchDTO,
  SegmentSearchHitDTO,
  MeetingDTO,
  MeetingEndReason,
  MeetingListDTO,
  MeetingSource,
  MeetingStatus,
  MeetingSummaryDTO,
  SegmentDTO,
  SegmentPageDTO,
} from "./api/meeting";
export type {
  DocumentExportDTO,
  DocumentSearchDTO,
  DocumentSearchHitDTO,
  DocumentSummaryDTO,
} from "./api/document";
export type { Message } from "./api/message";
export type { Member, Workspace } from "./api/workspaces";

export type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "./socket/socketEvents";

export type { PointerTool, PresenceUser } from "./socket/presence";
export type { VoiceUser } from "./socket/voice";

export type { BotResult } from "./api/bot";

export {
  AI_DEFAULT_VOICE,
  AI_FEATURES,
  AI_FEATURE_KIND,
  AI_FEATURE_RECOMMENDED,
  AI_FEATURE_REQUIREMENTS,
  AI_MODEL_KINDS,
  AI_MODEL_SOURCES,
  AI_PROVIDERS,
  AI_PROVIDER_IDS,
  capabilitiesMeetRequirements,
  defaultModelFor,
  featuresServedBy,
  meetsRequirements,
  modelById,
  modelKind,
  modelsFor,
  modelsOfKind,
  providerHasKind,
  type AiCapability,
  type AiEffort,
  type AiFeature,
  type AiModelKind,
  type AiModelPricing,
  type AiModelSource,
  type AiModelSpec,
  type AiProviderId,
  type AiProviderSpec,
} from "./ai/providers";
