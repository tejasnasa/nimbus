import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { loginSchema } from "@nimbus/types";
import { authClient } from "../lib/auth-client";

export function useLoginForm() {
  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const { email, password, root } = form.formState.errors;
  const firstError = email?.message || password?.message || root?.message;

  const onSubmit = form.handleSubmit(async (data) => {
    try {
      await authClient.signIn.email({
        email: data.email,
        password: data.password,
        callbackURL: "/home",
      });
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
