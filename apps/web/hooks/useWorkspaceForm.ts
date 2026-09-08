import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
/**
 * @module web/hooks/useWorkspaceForm
 * @description Create-workspace form: Zod-validated name/description,
 * POSTs to `/api/workspace/create`, and routes to the new workspace on
 * success. Server failures surface as a root form error.
 */
import { workspaceSchema } from "@nimbus/types";
import { useRouter } from "next/navigation";

/** Create-workspace form state (register, firstError, isSubmitting, onSubmit). */
export function useWorkspaceForm() {
  const router = useRouter();
  const form = useForm<z.infer<typeof workspaceSchema>>({
    resolver: zodResolver(workspaceSchema),
    defaultValues: { name: "", description: "" },
  });

  const { name, description, root } = form.formState.errors;
  const firstError = name?.message || description?.message || root?.message;

  const onSubmit = form.handleSubmit(async (data) => {
    try {
      console.log(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/workspace/create`,
      );
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/workspace/create`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(data),
        },
      );

      if (!res.ok) {
        const error = await res.json();
        throw new Error(
          error.message ?? "Something went wrong. Please try again.",
        );
      }

      router.push(`/workspace/${(await res.json()).responseObject.slugId}`);
    } catch (error) {
      form.setError("root", {
        message:
          (error as { message?: string }).message ??
          "Something went wrong. Please try again.",
      });
    }
  });

  return {
    register: form.register,
    firstError,
    isSubmitting: form.formState.isSubmitting,
    onSubmit,
  };
}
