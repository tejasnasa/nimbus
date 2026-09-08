import { zodResolver } from "@hookform/resolvers/zod";
import { loginSchema } from "@nimbus/types";
import { useForm } from "react-hook-form";
import { z } from "zod";
/**
 * @module web/hooks/useLoginForm
 * @description Email/password sign-in form (`callbackURL: "/home"`).
 * Unverified emails (403) get a dedicated message instead of the raw error.
 */
import { authClient } from "../lib/auth-client";

/** Sign-in form state (register, firstError, isSubmitting, onSubmit). */
export function useLoginForm() {
  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const { email, password, root } = form.formState.errors;
  const firstError = email?.message || password?.message || root?.message;

  const onSubmit = form.handleSubmit(async (data) => {
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
              form.setError("root", {
                message: "Please verify your email before signing in.",
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

  return {
    register: form.register,
    firstError,
    isSubmitting: form.formState.isSubmitting,
    onSubmit,
  };
}
