/**
 * @module validations/account
 * @description Zod schemas for the account-settings forms: profile (name +
 * avatar) and change-password (current/new/confirm). The change-password
 * schema is the same surface used to *set* a password for Google-only users
 * the "current" field is omitted there, but that branch lives
 * in the hook (it uses `requestPasswordReset` instead of `changePassword`),
 * not in this schema.
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
 *  change their own password. */
export const changePasswordSchema = z
  .object({
    currentPassword: z
      .string()
      .min(1, { message: "Enter your current password." }),
    newPassword: z
      .string()
      .min(8, { message: "Password must be at least 8 characters." }),
    confirmPassword: z.string(),
    revokeOtherSessions: z.boolean().default(true),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });
