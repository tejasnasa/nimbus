/**
 * @module web/hooks/useDeleteAccount
 * @description Account-deletion manager for the `/settings` Danger Zone tab.
 *
 * The hook probes `listAccounts` once on mount to decide which payload to
 * send: users with a credential account must include `password` (it both
 * re-authenticates an irreversible action and bypasses the 24h freshness
 * gate in `better-auth`'s `deleteUser`). Google-only users omit it
 * entirely, and a >24h session on that branch yields a `SESSION_EXPIRED`
 * error — the hook handles that by signing the user out and navigating
 * to `/login`, since re-login yields a fresh session the user can retry.
 *
 * @important `deleteUser` does **not** redirect. The endpoint only uses
 *            `callbackURL` when `sendDeleteAccountVerification` is
 *            configured (deliberately not configured in
 *            `apps/api/src/lib/auth.ts`), so a successful response is
 *            plain JSON. The hook navigates explicitly in its success
 *            path; `callbackURL` is never sent.
 *
 * @important The freshness gate runs *before* `beforeDelete`, so a
 *            `SESSION_EXPIRED` rejection aborts cleanly and no workspace
 *            is deleted. The user can retry after re-login with no
 *            cleanup to undo.
 *
 * @important The session cookie is bound to the same auth client that
 *            just rejected the call, so `authClient.signOut()` is the
 *            correct way to clear it — calling the API's
 *            `/api/auth/sign-out` endpoint directly would not update the
 *            client's atom store.
 */
import { deleteAccountSchema } from "@nimbus/types";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm, type UseFormRegister } from "react-hook-form";
import { z } from "zod";
import { authClient } from "../lib/auth-client";

/** A single account row returned by `/list-accounts`. Only `providerId`
 *  is read. */
type Account = { providerId: string };

/** better-auth error context handed to `onError`. */
type AuthError = {
  error: { message?: string; code?: string };
};

/** Resolves to `true` when the user has at least one credential account,
 *  `false` for a Google-only user, `null` while the request is in flight. */
type HasPassword = boolean | null;

/** Form shape consumed by RHF. The password field is always declared so the
 *  form structure is stable across branches; the hook decides whether to
 *  forward it. */
type DeleteAccountValues = z.infer<typeof deleteAccountSchema>;

/** `deleteUser` returns either a plain success or a `SESSION_EXPIRED` error
 *  for a stale Google-only session. Other errors are surfaced verbatim. */
type DeleteOutcome =
  | { kind: "success" }
  | { kind: "session-expired" }
  | { kind: "error"; message: string };

/** Discriminated return so the consumer renders the right fields off `kind`. */
export type DeleteAccountState =
  | {
      kind: "loading";
      loadError: string | null;
    }
  | {
      kind: "ready";
      register: UseFormRegister<DeleteAccountValues>;
      firstError: string | undefined;
      isSubmitting: boolean;
      needsPassword: boolean;
      expectedEmail: string;
      /** True when the typed confirmation exactly matches the user's
       *  email (case-insensitive, trimmed). The destructive submit
       *  button is gated on this so an empty or near-match input never
       *  opens a click target. */
      confirmMatches: boolean;
      onSubmit: () => void;
      /** Inline message from the last submit attempt (server-failure path)
       *  — distinct from the form-level `firstError`, which reflects RHF
       *  validation issues. */
      submitError: string | null;
      /** Transient banner shown after a successful delete, before the
       *  navigation lands. */
      deleted: boolean;
    };

/**
 * @param email - The current user's email. Used both to seed the typed
 *                confirmation gate and to decide whether `password` is
 *                required (it is for credential users, not for
 *                Google-only users).
 */
export function useDeleteAccount(email: string): DeleteAccountState {
  const router = useRouter();

  // Probe the account list once on mount, same approach as
  // `useChangePasswordForm`. The user's auth surface only changes by
  // signing in/out, which unmounts the `/settings` page anyway.
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

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);

  const form = useForm<DeleteAccountValues>({
    resolver: zodResolver(deleteAccountSchema),
    defaultValues: { confirmEmail: "", password: "" },
  });

  const onSubmit = form.handleSubmit(async ({ confirmEmail, password }) => {
    // The typed confirmation must exactly match the user's email (case-
    // insensitive). A near-match with one character changed is still a
    // reject — the schema only validates the email shape; the equality
    // check is the actual gate.
    if (confirmEmail.trim().toLowerCase() !== email.toLowerCase()) {
      form.setError("confirmEmail", {
        message: "Email does not match your account email.",
      });
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    // Build the wire payload off the credential branch. Google-only users
    // never send `password` — sending an empty string would still
    // re-trigger the freshness gate on the server side, which is the
    // wrong behaviour for a Google-only user with a fresh session.
    const payload: { password?: string } = {};
    if (hasPassword) {
      payload.password = password?.length ? password : undefined;
    }

    // Captured through a wrapper so the post-await type narrowing works
    // cleanly. better-auth resolves even on error and only signals the
    // outcome through `onSuccess`/`onError`; we record it here and read
    // it after the await.
    const captured: { outcome: DeleteOutcome } = {
      outcome: { kind: "error", message: "" },
    };

    try {
      await authClient.deleteUser(payload, {
        onSuccess: () => {
          captured.outcome = { kind: "success" };
        },
        onError: (ctx) => {
          if (ctx.error.code === "SESSION_EXPIRED") {
            captured.outcome = { kind: "session-expired" };
            return;
          }
          captured.outcome = {
            kind: "error",
            message:
              ctx.error.message ??
              "Could not delete your account. Please try again.",
          };
        },
      });
    } catch (err) {
      captured.outcome = {
        kind: "error",
        message:
          (err as { message?: string }).message ??
          "Could not delete your account. Please try again.",
      };
    } finally {
      setIsSubmitting(false);
    }

    const outcome = captured.outcome;

    if (outcome.kind === "success") {
      setDeleted(true);
      // Sign out so the client atom store does not show a stale session
      // for the about-to-be-deleted account, then navigate. We do not
      // wait on the signOut — the redirect is the user-visible thing.
      void authClient.signOut();
      router.push("/login");
      return;
    }

    if (outcome.kind === "session-expired") {
      // The freshness gate ran before `beforeDelete`, so nothing was
      // deleted. Drop the stale session and send the user to re-login;
      // the resulting fresh session lets them retry immediately.
      void authClient.signOut();
      router.push("/login");
      return;
    }

    setSubmitError(outcome.message);
  });

  const { errors } = form.formState;
  const firstError =
    errors.confirmEmail?.message ||
    errors.password?.message ||
    errors.root?.message;

  // Watch the confirmation field so the destructive submit button is
  // disabled until the typed email exactly matches the user's email.
  // The equality check is case-insensitive to match the on-submit gate,
  // but trims whitespace so a stray space does not let a near-match
  // through.
  const confirmMatches =
    form.watch("confirmEmail")?.trim().toLowerCase() === email.toLowerCase();

  if (hasPassword === null) {
    return { kind: "loading", loadError };
  }

  return {
    kind: "ready",
    register: form.register,
    firstError,
    isSubmitting,
    needsPassword: hasPassword,
    expectedEmail: email,
    confirmMatches,
    onSubmit,
    submitError,
    deleted,
  };
}
