import { zodResolver } from "@hookform/resolvers/zod";
import { loginSchema } from "@nimbus/types";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
/**
 * @module web/hooks/useLoginForm
 * @description Email/password sign-in form (`callbackURL: "/home"`).
 * Unverified emails (403) get a dedicated message instead of the raw error,
 * and the address is kept so the form can offer to send the link again.
 *
 * @important The API already mails a fresh link on that 403 (better-auth's
 *            `sendOnSignIn`), so the message says so; the resend button is for
 *            a link that still has not arrived.
 */
import { authClient } from "../lib/auth-client";

/** Where a resend of the verification email stands. */
export type ResendState = "idle" | "sending" | "sent" | "error";

/**
 * Sign-in form state (register, firstError, isSubmitting, onSubmit), plus the
 * unverified address and the resend action.
 */
export function useLoginForm() {
  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const [resendState, setResendState] = useState<ResendState>("idle");

  const { email, password, root } = form.formState.errors;
  const firstError = email?.message || password?.message || root?.message;

  const onSubmit = form.handleSubmit(async (data) => {
    setUnverifiedEmail(null);
    setResendState("idle");
    try {
      await authClient.signIn.email(
        {
          email: data.email,
          password: data.password,
          callbackURL: "/home",
        },
        {
          onError: (ctx) => {
            if (ctx.error.status === 403) {
              setUnverifiedEmail(data.email);
              form.setError("root", {
                message:
                  "Please verify your email before signing in. We've sent you a new link.",
              });
            } else {
              form.setError("root", { message: ctx.error.message });
            }
          },
        },
      );
    } catch (error) {
      if (error) {
        form.setError("root", {
          message:
            (error as { message?: string }).message ??
            "Something went wrong. Please try again.",
        });
      }
    }
  });

  const resendVerification = async () => {
    if (!unverifiedEmail) return;
    setResendState("sending");
    try {
      const { error } = await authClient.sendVerificationEmail({
        email: unverifiedEmail,
        callbackURL: "/email-verified",
      });
      setResendState(error ? "error" : "sent");
    } catch {
      setResendState("error");
    }
  };

  return {
    register: form.register,
    firstError,
    isSubmitting: form.formState.isSubmitting,
    onSubmit,
    unverifiedEmail,
    resendState,
    resendVerification,
  };
}
