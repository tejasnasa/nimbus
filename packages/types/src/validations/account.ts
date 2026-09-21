/**
 * @module validations/account
 * @description Zod schemas for the account-settings forms: profile (name +
 * avatar), change-password (current/new/confirm), and account deletion
 * (typed email confirmation, optional password). The change-password
 * schema is the same surface used to *set* a password for Google-only users
 * the "current" field is omitted there, but that branch lives
 * in the hook (it uses `requestPasswordReset` instead of `changePassword`),
 * not in this schema. The deletion schema similarly keeps the password
 * optional: the Google-only branch never sends one.
 *
 * @important `updateUser`'s body is `z.record(z.string(), z.any())` on the
 *            server, and it throws `EMAIL_CAN_NOT_BE_UPDATED` if the body
 *            contains `email`. Email change is a separate verified flow and
 *            is not exposed here. `profileSchema` therefore does not declare
 *            an email field at all — including one would mean every save
 *            fails.
 *
 * @important There is no server-side length validation on `name`, so this
 *            schema is the only guard. An empty name would otherwise be
 *            persisted, which is the bug `min(1)` prevents.
 */

import { z } from "zod";

/** Editable profile fields. The matching `authClient.updateUser({...})` call
 *  forwards only the dirty fields (see `useProfileForm`). */
export const profileSchema = z.object({
  name: z
    .string()
    .min(1, { message: "Name cannot be empty." })
    .max(64, { message: "Name must be at most 64 characters." }),
  image: z.string().nullable().optional(),
});

/** Change-password payload. Password length is the minimum `resetSchema`
 *  already enforces (8 chars), not the stricter `signupSchema` rules — a
 *  user who signed up before the rules tightened must still be able to
 *  change their own password.
 *
 *  `revokeOtherSessions` is optional in the schema; the hook seeds `true`
 *  in `defaultValues` so a user who never opens the toggle still signs
 *  every other device out — the security-relevant default that
 *  `apps/api/src/lib/auth.ts` reflects with its
 *  `revokeSessionsOnPasswordReset: true` setting. */
export const changePasswordSchema = z
  .object({
    currentPassword: z
      .string()
      .min(1, { message: "Enter your current password." }),
    newPassword: z
      .string()
      .min(8, { message: "Password must be at least 8 characters." }),
    confirmPassword: z.string(),
    revokeOtherSessions: z.boolean().optional(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

/** Account-deletion payload. The dialog gates the destructive button on a
 *  typed `confirmEmail` match, which is the account-level equivalent of the
 *  workspace-delete "type the workspace name" gate. The match is exact and
 *  case-insensitive so a stray capital does not let a user through by
 *  mistake but a near-match with one character changed is still rejected.
 *
 *  `password` is required for users with a credential account (it
 *  re-authenticates an irreversible action *and* bypasses the 24h
 *  freshness gate). Google-only users have no password to send; the hook
 *  omits the field entirely for that branch. The schema marks it as
 *  optional so the hook can build the wire payload off the user branch.
 *
 *  The wire payload never carries `callbackURL` — `deleteUser` does not
 *  redirect, and the client navigates explicitly in its success path. */
export const deleteAccountSchema = z.object({
  confirmEmail: z
    .string()
    .min(1, { message: "Type your email to confirm." })
    .refine((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), {
      message: "Enter your full email address.",
    }),
  password: z.string().optional(),
});
