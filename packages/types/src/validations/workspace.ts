/**
 * @module validations/workspace
 * @description Zod schemas for every workspace mutation: create, update, join,
 * and member role/removal. Shared by the API routes (via `validate`) and the
 * web forms, so client and server constraints cannot drift.
 */

import { z } from "zod";

/**
 * Payload for creating or renaming a workspace.
 *
 * Used by both `POST /api/workspace/create` and `PUT /api/workspace/update/:wsid`
 * — the two accept the same fields with the same constraints.
 */
export const workspaceSchema = z.object({
  name: z
    .string()
    .min(3, "Workspace name must be at least 3 characters")
    .max(25, "Workspace name must be at most 25 characters"),
  description: z
    .string()
    .max(255, "Description must be at most 255 characters")
    .optional(),
});

/**
 * Payload for joining an existing workspace via its invite code.
 *
 * Shape only, deliberately. An empty code still reaches the controller, which
 * answers with its specific "Invalid invite code" — a better message than a
 * generic validation error, and the check that has the context to make it.
 * Schemas in this module enforce the shape of the body; the controller owns
 * the meaning of its contents.
 */
export const workspaceJoinSchema = z.object({
  inviteCode: z.string(),
});

/**
 * Payload for changing a member's role.
 *
 * `OWNER` is accepted by the schema for the same reason the join schema accepts
 * an empty code: the controller owns the role invariants, and it answers a
 * promotion request with the specific 403 ("you cannot make someone owner")
 * rather than a generic validation 400.
 */
export const workspaceRoleSchema = z.object({
  memberId: z.string(),
  role: z.enum(["OWNER", "ADMIN", "MEMBER"]),
});

/** Payload for removing a member from a workspace. Shape only — see above. */
export const workspaceMemberSchema = z.object({
  memberId: z.string(),
});
