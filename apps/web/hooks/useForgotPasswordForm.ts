import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { authClient } from "../lib/auth-client";
import { forgotSchema } from "@nimbus/types";

export function useForgotPasswordForm() {
  const form = useForm<z.infer<typeof forgotSchema>>({
    resolver: zodResolver(forgotSchema),
    defaultValues: { email: "" },
  });
  const [sent, setSent] = useState(false);

  const { email, root } = form.formState.errors;
  const firstError = email?.message || root?.message;

  const onSubmit = form.handleSubmit(async ({ email }) => {
    try {
      await authClient.requestPasswordReset(
        {
          email,
          redirectTo: `${process.env.NEXT_PUBLIC_FRONTEND_URL}/reset-password`,
        },
        {
          onError: (ctx) => {
            form.setError("root", { message: ctx.error.message });
          },
          onSuccess: () => {
            setSent(true);
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
    sent,
  };
}
