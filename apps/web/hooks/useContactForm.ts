/**
 * @module web/hooks/useContactForm
 * @description Public contact form: Zod-validated fields, the POST to
 * `/api/contact`, and the `sent` flag the form swaps itself for on success.
 * There is no toast in this app, so the confirmation is state the component
 * renders.
 *
 * The category is exposed through `watch`/`setValue` rather than `register`
 * because it is a combobox, not a native input; `useAddApiKeyForm` wires its
 * provider field the same way.
 *
 * @important The request deliberately omits `credentials: "include"`. The
 *            endpoint reads no session, so sending the cookie would imply an
 *            identity that nothing verifies — the prefill below is a
 *            convenience the sender can edit, not an authenticated claim.
 */
import { contactSchema } from "@nimbus/types";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";

/** One submission, as the form holds it. */
export type ContactValues = z.infer<typeof contactSchema>;

/** Values the page can seed from the session; both stay editable. */
type Prefill = { name?: string | null; email?: string | null };

/** The untouched form, seeded from any prefill. */
const emptyForm = (prefill: Prefill = {}) => ({
  category: undefined,
  name: prefill.name ?? "",
  email: prefill.email ?? "",
  message: "",
  nimbus_hp: "",
});

/**
 * Contact-form state and submit handler.
 *
 * @param prefill - Optional name/email to seed the fields with.
 * @returns The RHF handles, the first field error, the in-flight flag, the
 *          sent flag, the submit handler, and `sendAnother` to start over.
 */
export function useContactForm(prefill: Prefill = {}) {
  const form = useForm<ContactValues>({
    resolver: zodResolver(contactSchema),
    defaultValues: emptyForm(prefill),
  });
  const [sent, setSent] = useState(false);

  const { errors } = form.formState;
  const firstError =
    errors.category?.message ||
    errors.name?.message ||
    errors.email?.message ||
    errors.message?.message ||
    errors.root?.message;

  const onSubmit = form.handleSubmit(async (data) => {
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/contact`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
      );

      if (!res.ok) {
        // The API answers every failure in the same envelope, so its message
        // is what the sender should see — a provider error is described
        // generically there and only logged in full on the server.
        const error = await res.json().catch(() => null);
        throw new Error(
          error?.message ?? "Something went wrong. Please try again.",
        );
      }

      setSent(true);
    } catch (error) {
      form.setError("root", {
        message:
          (error as { message?: string }).message ??
          "Something went wrong. Please try again.",
      });
    }
  });

  /** Returns to an empty form, keeping the session prefill. */
  const sendAnother = () => {
    form.reset(emptyForm(prefill));
    setSent(false);
  };

  return {
    register: form.register,
    watch: form.watch,
    setValue: form.setValue,
    errors,
    firstError,
    isSubmitting: form.formState.isSubmitting,
    sent,
    onSubmit,
    sendAnother,
  };
}
