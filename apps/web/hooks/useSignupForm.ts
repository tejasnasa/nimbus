import { zodResolver } from "@hookform/resolvers/zod";
import { signupSchema } from "@nimbus/types";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { authClient } from "../lib/auth-client";

export function useSignupForm() {
  const form = useForm<z.infer<typeof signupSchema>>({
    resolver: zodResolver(signupSchema),
    defaultValues: { name: "", email: "", password: "" },
  });
  const [showVerifyDialog, setShowVerifyDialog] = useState(false);
  const watchedEmail = form.watch("email");

  const { name, email, password, root } = form.formState.errors;
  const firstError =
    name?.message || email?.message || password?.message || root?.message;

  const onSubmit = form.handleSubmit(async (data) => {
    try {
      await authClient.signUp.email(
        {
          name: data.name,
          email: data.email,
          password: data.password,
          callbackURL: "/email-verified",
        },
        {
          onSuccess: () => {
            setShowVerifyDialog(true);
          },
          onError: (ctx) => {
            form.setError("root", { message: ctx.error.message });
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
    showVerifyDialog,
    setShowVerifyDialog,
    submittedEmail: watchedEmail,
  };
}
