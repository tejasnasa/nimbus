import { zodResolver } from "@hookform/resolvers/zod";
import { documentSchema } from "@nimbus/types";
import { useForm } from "react-hook-form";
import { z } from "zod";
/**
 * @module web/hooks/useWorkspaceDocumentForm
 * @description New-document form: validates title/type, POSTs to
 * `/api/document/create`, closes the dialog (`close-doc-dialog` click),
 * maps the response to a `ClientDocument`, resets, and opens it via `addTab`.
 */
import { ClientDocument } from "../api/document";

/**
 * New-document form state.
 *
 * @param workspaceId - Owning workspace (form default).
 * @param addTab - Opens the created document in the editor.
 */
export function useWorkspaceDocumentForm(
  workspaceId: string,
  addTab?: (doc: ClientDocument) => void,
) {
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
    errors.title?.message ||
    errors.type?.message ||
    errors.workspaceId?.message ||
    errors.root?.message;

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

      if (!res.ok) {
        const error = await res.json();
        throw new Error(
          error.message ?? "Something went wrong. Please try again.",
        );
      }

      document.getElementById("close-doc-dialog")?.click();
      const json = await res.json();
      const doc = json.responseObject;
      const clientDoc: ClientDocument = {
        id: doc.id,
        label: doc.title,
        type: doc.type,
        elements: Array.isArray(doc.canvasData) ? doc.canvasData : [],
        yjsState: doc.yjsState ?? null,
      };

      form.reset();
      if (addTab) {
        addTab(clientDoc);
      }
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
