/**
 * @module web/hooks/useChangePasswordForm
 * @description Two-branch password manager for the `/settings` Password tab.
 *
 * - **Has-password** users (any account with `providerId === "credential"`)
 *   get a Current / New / Confirm form calling `authClient.changePassword`,
 *   with a default-on `revokeOtherSessions` checkbox (mirroring
 *   `apps/api/src/lib/auth.ts`'s `revokeSessionsOnPasswordReset: true`).
 * - **Google-only** users get a single "Send me a set-password link" button
 *   that calls `authClient.requestPasswordReset` with `redirectTo:
 *   FRONTEND_URL/reset-password`. There is **no** `changePassword` call in
 *   this branch — better-auth's `changePassword` throws
 *   `CREDENTIAL_ACCOUNT_NOT_FOUND` for users without a credential account,
 *   so this branch is not cosmetic; the wrong call is a hard failure.
 *
 * @important The "no-credential account" branch is *not* `setPassword`:
 *            better-auth's `setPassword` exists but is not wired into the
 *            client singleton; the *resetPassword* handler creates a
 *            credential row when one is absent, so the existing reset flow
 *            is the correct affordance. This keeps the "no new REST route"
 *            decision intact — the has-password and Google-only branches
 *            share one mechanism.
 *
 * @important `listAccounts` (path `/list-accounts`) is the has-password
 *            signal. better-auth's react client derives method names by
 *            camel-casing the **path**, so the client key is
 *            `listAccounts` — `listUserAccounts` is only the `operationId`
 *            (telemetry/OpenAPI), not the client method.
 *
 *            `changePassword` requires only `sensitiveSessionMiddleware`,
 *            so no re-auth prompt is needed for the has-password path.
 */
import { changePasswordSchema } from "@nimbus/types";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm, type UseFormRegister } from "react-hook-form";
import type { z } from "zod";
import { authClient } from "../lib/auth-client";

/** A single account row returned by `/list-accounts`. Only `providerId`
 *  is read; the rest is opaque. */
type Account = { providerId: string };

/** Server-side error context that `better-auth` hands to `onError`. */
type AuthError = { error: { message?: string; code?: string } };

/** Resolves to `true` when the user has at least one credential account,
 *  `false` for a Google-only user, `null` while the request is in flight. */
type HasPassword = boolean | null;

/** Form shape consumed by RHF. The schema marks
 *  `revokeOtherSessions` as optional; the hook seeds `true` in defaults
 *  so a user who never opens the toggle still sends `true` to the
 *  server. */
type ChangePasswordValues = z.infer<typeof changePasswordSchema>;

/** Discriminated return describing which sub-hook is active. The
 *  consumer renders the matching JSX off `kind` — keeping the hooks
 *  unconditional above this layer. */
export type ChangePasswordState =
  | { kind: "loading"; loadError: string | null }
  | {
      kind: "with-password";
      register: UseFormRegister<ChangePasswordValues>;
      firstError: string | undefined;
      isSubmitting: boolean;
      onSubmit: () => void;
    }
  | {
      kind: "google-only";
      onSubmit: () => Promise<void>;
      submitting: boolean;
      sent: boolean;
      error: string | null;
    };

/**
 * @param email - The current user's email. Used as the address for
 *                `requestPasswordReset` in the Google-only branch. Required
 *                because better-auth's reset request is keyed by email.
 */
export function useChangePasswordForm(email: string): ChangePasswordState {
  // Probe the account list once on mount. A re-fetch isn't useful: the
  // user's auth surface only changes by signing in/out, which unmounts the
  // `/settings` page anyway.
  const [hasPassword, setHasPassword] = useState<HasPassword>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void authClient
      .listAccounts()
      .then((res) => {
        if (cancelled) return;
        const accounts = ((res as { data?: unknown }).data ?? res) as
          | Account[]
          | undefined;
        const found = Array.isArray(accounts)
          ? accounts.some((a) => a?.providerId === "credential")
          : false;
        setHasPassword(found);
      })
      .catch((err: AuthError) => {
        if (cancelled) return;
        setLoadError(
          err?.error?.message ??
            "Could not check your sign-in methods. Please try again.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Both sub-hooks are *always* invoked. They are cheap (no network
  // until submit) and keeping the call order unconditional satisfies
  // the Rules of Hooks. The discriminated state narrows which fields
  // are valid at the consumer.
  const withPassword = useWithPasswordForm();
  const googleOnly = useGoogleOnlyForm(email);

  if (hasPassword === null) {
    return { kind: "loading", loadError };
  }
  if (hasPassword) {
    return { kind: "with-password", ...withPassword };
  }
  return { kind: "google-only", ...googleOnly };
}

/**
 * The change-password form for users with an existing credential account.
 * Submits `authClient.changePassword({ currentPassword, newPassword,
 * revokeOtherSessions })`. The checkbox defaults to `true` because
 * session revocation on password change is the security default
 * (matching `apps/api/src/lib/auth.ts`'s `revokeSessionsOnPasswordReset`).
 */
function useWithPasswordForm() {
  const form = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
      // Seed the toggle's default here (rather than via
      // `changePasswordSchema.default(true)`) so the schema's input type
      // stays `boolean | undefined` — the wire payload always carries
      // `true` from this seed.
      revokeOtherSessions: true,
    },
  });

  const { isSubmitting, errors } = form.formState;
  const firstError =
    errors.currentPassword?.message ||
    errors.newPassword?.message ||
    errors.confirmPassword?.message ||
    errors.root?.message;

  // better-auth resolves the promise even on an error response and only
  // signals failure through the `onError` callback. We track success with
  // a flag so the success path (reset) only runs when the call actually
  // succeeded.
  const onSubmit = form.handleSubmit(
    async ({ currentPassword, newPassword, revokeOtherSessions }) => {
      let succeeded = false;
      try {
        await authClient.changePassword(
          {
            currentPassword,
            newPassword,
            revokeOtherSessions: revokeOtherSessions ?? true,
          },
          {
            onSuccess: () => {
              succeeded = true;
            },
            onError: (ctx) => {
              form.setError("root", {
                message:
                  ctx.error.message ??
                  "Could not change your password. Please try again.",
              });
            },
          },
        );

        if (!succeeded) return;

        // Clear the fields; the form is otherwise sticky and would let a
        // user mash Change with stale values after a save.
        form.reset({
          currentPassword: "",
          newPassword: "",
          confirmPassword: "",
          revokeOtherSessions: true,
        });
      } catch (error) {
        form.setError("root", {
          message:
            (error as { message?: string }).message ??
            "Could not change your password. Please try again.",
        });
      }
    },
  );

  return {
    register: form.register,
    firstError,
    isSubmitting,
    onSubmit,
  };
}

/**
 * The Google-only branch: a single button calling
 * `authClient.requestPasswordReset`. The resetPassword endpoint
 * *creates* the credential account when one is absent (better-auth's
 * own logic), so this is the correct affordance — no separate
 * `setPassword` flow.
 */
function useGoogleOnlyForm(email: string) {
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await authClient.requestPasswordReset(
        {
          email,
          redirectTo: `${process.env.NEXT_PUBLIC_FRONTEND_URL}/reset-password`,
        },
        {
          onSuccess: () => {
            setSent(true);
          },
          onError: (ctx) => {
            setError(
              ctx.error.message ??
                "Could not send the set-password link. Please try again.",
            );
          },
        },
      );
    } catch (err) {
      setError(
        (err as { message?: string }).message ??
          "Could not send the set-password link. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return { onSubmit, submitting, sent, error };
}
