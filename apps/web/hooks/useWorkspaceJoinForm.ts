import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { workspaceJoinSchema } from "@nimbus/types";
import { useRouter } from "next/navigation";

export function useWorkspaceJoinForm() {
  const router = useRouter();
  const form = useForm<z.infer<typeof workspaceJoinSchema>>({
    resolver: zodResolver(workspaceJoinSchema),
    defaultValues: { inviteCode: "" },
  });

  const { inviteCode, root } = form.formState.errors;
  const firstError = inviteCode?.message || root?.message;

  const onSubmit = form.handleSubmit(async (data) => {
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/workspace/join`,
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
