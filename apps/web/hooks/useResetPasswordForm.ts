import { zodResolver } from "@hookform/resolvers/zod";
import { resetSchema } from "@nimbus/types";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import { z } from "zod";
/**
 * @module web/hooks/useResetPasswordForm
 * @description Password-reset completion: submits the new password with the
 * emailed token, flips `done`, and routes to `/login` after 2.5s.
 */
import { authClient } from "../lib/auth-client";

/**
 * @param token - Reset token from the emailed link.
 */
export function useResetPasswordForm(token: string) {
  const router = useRouter();
  const form = useForm<z.infer<typeof resetSchema>>({
    resolver: zodResolver(resetSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });
  const [done, setDone] = useState(false);

  const { password, confirmPassword, root } = form.formState.errors;
  const firstError =
    password?.message || confirmPassword?.message || root?.message;

  const onSubmit = form.handleSubmit(async ({ password }) => {
    try {
      await authClient.resetPassword(
        { newPassword: password, token },
        {
          onError: (ctx) => {
            form.setError("root", {
              message:
                ctx.error.message ??
                "Something went wrong. The link may have expired.",
            });
          },
          onSuccess: () => {
            setDone(true);
            setTimeout(() => router.push("/login"), 2500);
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
    done,
  };
}
