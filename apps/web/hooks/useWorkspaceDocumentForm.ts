import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { documentSchema } from "@nimbus/types";
import { useRouter } from "next/navigation";

export function useWorkspaceDocumentForm(workspaceId: string) {
  const router = useRouter();
  const form = useForm<z.infer<typeof documentSchema>>({
    resolver: zodResolver(documentSchema),
    defaultValues: {
      title: "",
      type: "MARKDOWN",
      workspaceId,
    },
  });

  const { isSubmitting, errors } = form.formState;
  const firstError =
    errors.title?.message || errors.type?.message || errors.workspaceId?.message || errors.root?.message;

  const onSubmit = form.handleSubmit(async (data) => {
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/document/create`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(data),
        },
      );

      console.log(res);

      if (!res.ok) {
        const error = await res.json();
        throw new Error(
          error.message ?? "Something went wrong. Please try again.",
        );
      }

      form.reset();
      window.location.reload();
      document.getElementById("close-doc-dialog")?.click();
    } catch (error) {
      alert((error as { message?: string }).message ?? "Something went wrong.");
    }
  });

  return {
    register: form.register,
    setValue: form.setValue,
    watch: form.watch,
    firstError,
    isSubmitting,
    onSubmit,
  };
}
