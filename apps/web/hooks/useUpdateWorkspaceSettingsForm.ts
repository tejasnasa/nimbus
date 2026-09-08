import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
/**
 * @module web/hooks/useUpdateWorkspaceSettingsForm
 * @description Workspace rename/description form prefilled from the current
 * workspace. Resets the dirty flag and refreshes the route on success;
 * failures surface as a root form error.
 */
import { workspaceSchema, Workspace } from "@nimbus/types";
import { useRouter } from "next/navigation";

/**
 * @param workspace - Current workspace (seeds name/description defaults).
 */
export function useUpdateWorkspaceSettingsForm(workspace: Workspace) {
  const router = useRouter();
  const form = useForm<z.infer<typeof workspaceSchema>>({
    resolver: zodResolver(workspaceSchema),
    defaultValues: {
      name: workspace.name,
      description: workspace.description || "",
    },
  });

  const { isDirty, isSubmitting, errors } = form.formState;
  const firstError =
    errors.name?.message || errors.description?.message || errors.root?.message;

  const onSubmit = form.handleSubmit(async (data) => {
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/workspace/update/${workspace.id}`,
        {
          method: "PUT",
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

      form.reset(data);
      router.refresh();
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
    isSubmitting,
    isDirty,
    onSubmit,
  };
}
