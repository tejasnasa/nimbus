/**
 * @module types
 * @description Barrel export for `@nimbus/types`.
 *
 * Central home for shared Zod validation schemas, REST API DTOs, and the
 * typed Socket.IO event contracts used by both `apps/api` and `apps/web`.
 */

export { documentSchema } from "./validations/document";
export { forgotSchema, loginSchema, resetSchema } from "./validations/login";
export { signupSchema } from "./validations/signup";
export { workspaceJoinSchema, workspaceSchema } from "./validations/workspace";

export { ServerResponse } from "./api/serverResponse";

export type { Message } from "./api/message";
export type { Member, Workspace } from "./api/workspaces";

export type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "./socket/socketEvents";

export type { VoiceUser } from "./socket/voice";

export type { BotResult } from "./api/bot";
