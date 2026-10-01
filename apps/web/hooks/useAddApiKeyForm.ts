/**
 * @module web/hooks/useAddApiKeyForm
 * @description React Hook Form + Zod wrapper for the API-key dialog.
 *
 * Wraps the existing `aiCredentialCreateSchema` so the same validation runs
 * client-side as on the server. The hook's API has five primitives:
 *
 *   - `register(...)` for the form fields
 *   - `watch(name)` to read a single field reactively (used by the custom
 *     combobox trigger)
 *   - `setValue(name, value)` to update a single field (the combobox's
 *     `onChange` path)
 *   - `onSubmit()` for the submit handler
 *   - `reset()` to clear the key from local state (called on success and on
 *     dialog close)
 *
 * The submit handler accepts an external save function so this hook stays
 * decoupled from `useAiCredentials`. The save function receives the typed
 * values and returns the hook's `ok | error` discriminated result.
 *
 * @important The plaintext key is held in RHF state, which lives in React.
 *            The hook clears it via `reset()` on success and on close so the
 *            key is gone from memory as soon as the dialog completes.
 *            Reading `getValues().apiKey` from outside the dialog's submit
 *            path is unsupported.
 */
import { aiCredentialCreateSchema } from "@nimbus/types";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  useForm,
  type UseFormRegister,
  type UseFormSetValue,
} from "react-hook-form";
import type { z } from "zod";

export type AddApiKeyValues = z.infer<typeof aiCredentialCreateSchema>;

/** The discriminated outcome of a submit. */
export type SubmitResult = { ok: true } | { ok: false; message: string };

export type UseAddApiKeyForm = {
  register: UseFormRegister<AddApiKeyValues>;
  /**
   * Reads a single field reactively. Used by the custom combobox to render
   * the trigger label without forcing the whole form to re-render.
   */
  watch: <K extends keyof AddApiKeyValues>(name: K) => AddApiKeyValues[K];
  /**
   * Sets a single field. The custom combobox uses this in place of
   * `register("providerId").onChange` so the dialog can swap the native
   * `<select>` for the in-app combobox without changing RHF validation
   * wiring.
   */
  setValue: UseFormSetValue<AddApiKeyValues>;
  /** RHF-form-level error string, or `undefined` when nothing to show. */
  firstError: string | undefined;
  /** `true` while the submit is in flight. The Save button shows its spinner. */
  isSubmitting: boolean;
  /** Wraps the save in RHF validation, then clears the key on success. */
  onSubmit: (
    save: (values: AddApiKeyValues) => Promise<SubmitResult>,
  ) => Promise<SubmitResult>;
  /** Clears the key from RHF state. Call this from the dialog's close path too. */
  reset: () => void;
};

/**
 * RHF form for adding an API key. Submit goes through the caller-supplied
 * `save` function so the dialog can swap implementations for tests.
 *
 * @returns The form handles plus a `reset()` to clear the key.
 */
export function useAddApiKeyForm(): UseAddApiKeyForm {
  const form = useForm<AddApiKeyValues>({
    // `aiCredentialCreateSchema` uses `z.preprocess` so its `z.input` shape has
    // `label: unknown` while its `z.output` shape has `label?: string`. RHF's
    // `useForm<T>` types `T` as both the resolver's input and the field
    // values; the simplest robust fix is to align both sides on the output
    // shape via `as Resolver<AddApiKeyValues>` so the `unknown` from the
    // input side does not leak into the form-state types.
    resolver: zodResolver(
      aiCredentialCreateSchema,
    ) as unknown as import("react-hook-form").Resolver<AddApiKeyValues>,
    // `label` is optional in the schema; default to `undefined` so an empty
    // form does not trigger the `min(1)` validation that would apply to a
    // present-but-empty label.
    defaultValues: { providerId: "openai", apiKey: "", label: undefined },
  });

  const { isSubmitting, errors } = form.formState;
  const firstError =
    errors.apiKey?.message ||
    errors.providerId?.message ||
    errors.label?.message ||
    errors.root?.message;

  const onSubmit = async (
    save: (values: AddApiKeyValues) => Promise<SubmitResult>,
  ): Promise<SubmitResult> => {
    let result: SubmitResult = { ok: false, message: "" };
    await form.handleSubmit(async (raw) => {
      // RHF's generic types are `FieldValues`; the resolver narrows it to
      // `AddApiKeyValues` at runtime, but the generic doesn't carry that
      // through. Cast explicitly.
      const v = raw as unknown as AddApiKeyValues;
      result = await save(v);
      if (result.ok) {
        // Wipe the key from state — success means the server has it
        // encrypted, and the form no longer needs the plaintext copy.
        form.reset({
          providerId: v.providerId,
          apiKey: "",
          label: undefined,
        });
      } else {
        // Surface server-side errors at the form level so the dialog can
        // render them inline; do NOT clear the key, the user will fix and
        // resubmit.
        form.setError("root", { message: result.message });
      }
    })();
    return result;
  };

  const reset = () => {
    form.reset({ providerId: "openai", apiKey: "", label: undefined });
  };

  return {
    register: form.register,
    watch: form.watch as <K extends keyof AddApiKeyValues>(
      name: K,
    ) => AddApiKeyValues[K],
    setValue: form.setValue,
    firstError,
    isSubmitting,
    onSubmit,
    reset,
  };
}
