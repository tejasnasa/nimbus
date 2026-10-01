"use client";

/**
 * @module web/components/ApiKeyDialog
 * @description Add-or-replace-key modal. Controlled — opened by the parent
 * (the disabled composer, the AI settings panel, etc.) and rendered via the
 * portal'd, a11y-aware {@link AlertDialog} in controlled mode.
 *
 * The plaintext key is held only in RHF state. The dialog clears it on
 * submit success and on close so a stale value never lingers in memory.
 *
 * @important Backdrop and Escape call `onOpenChange(false)`, but the dialog
 *            only calls that after the key has been cleared. A request that
 *            is still in flight is **not** cancelled by closing — the
 *            background save continues, and the success/error state is
 *            reflected through `useAiCredentials`'s own refresh.
 */
import AlertDialog from "@nimbus/ui/AlertDialog";
import Button from "@nimbus/ui/Button";
import Input from "@nimbus/ui/Input";
import {
  AI_PROVIDERS,
  type AiProviderId,
} from "@nimbus/types";
import { useCallback } from "react";
import { useAddApiKeyForm } from "../hooks/useAddApiKeyForm";

type Props = {
  /** Whether the dialog is open. */
  open: boolean;
  /** Called with the next open state when the dialog wants to close. */
  onOpenChange: (open: boolean) => void;
  /**
   * The actual save call. The dialog does not own network code; the parent
   * (typically the AI settings panel) wires `useAiCredentials.save` here so
   * tests can swap a stub.
   */
  onSave: (
    values: { providerId: AiProviderId; apiKey: string; label?: string },
  ) => Promise<{ ok: true } | { ok: false; message: string }>;
  /**
   * Optional hint to pre-select a provider. Useful when the dialog was
   * opened from a credentialed provider's row in the panel — but the user
   * is always free to switch.
   */
  initialProvider?: AiProviderId;
};

/**
 * Add-or-replace-key modal.
 *
 * @param props.open - Whether the dialog is visible.
 * @param props.onOpenChange - Called with `false` when the user wants to
 *                              close. The dialog clears its key before
 *                              forwarding.
 * @param props.onSave - The actual save call. Resolves to a discriminated
 *                        result; on success, the key is cleared from state.
 */
export default function ApiKeyDialog({
  open,
  onOpenChange,
  onSave,
  initialProvider,
}: Props) {
  const { register, firstError, isSubmitting, onSubmit, reset } =
    useAddApiKeyForm();

  /** Closes the dialog and clears the key from state. */
  const handleClose = useCallback(() => {
    reset();
    onOpenChange(false);
  }, [reset, onOpenChange]);

  return (
    <AlertDialog open={open} onOpenChange={handleClose}>
      <form
        aria-label="add-api-key-form"
        className="relative z-50 w-110 rounded-2xl border border-(--border) bg-(--card) shadow-2xl p-6"
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit(onSave);
        }}
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-(--primary)/15 flex items-center justify-center shrink-0">
            <Key className="w-5 h-5 text-(--primary)" />
          </div>
          <div>
            <h3 className="font-semibold">Add API key</h3>
            <p className="text-xs text-(--muted-foreground)">
              Your key is encrypted at rest.
            </p>
          </div>
        </div>

        <label className="block text-xs font-medium mb-1">Provider</label>
        <select
          {...register("providerId")}
          defaultValue={initialProvider ?? "openai"}
          data-testid="api-key-provider"
          className="w-full h-11 rounded-xl px-3 text-sm border border-(--border) bg-(--muted)/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring) mb-4"
        >
          {Object.values(AI_PROVIDERS).map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>

        <label
          className="block text-xs font-medium mb-1"
          htmlFor="api-key-input"
        >
          API key
        </label>
        <Input
          id="api-key-input"
          type="password"
          autoComplete="off"
          data-testid="api-key-input"
          placeholder="sk-…"
          {...register("apiKey")}
        />

        <label
          className="block text-xs font-medium mb-1 mt-4"
          htmlFor="api-key-label"
        >
          Label (optional)
        </label>
        <Input
          id="api-key-label"
          data-testid="api-key-label"
          placeholder="My key"
          {...register("label")}
        />

        {firstError && (
          <p
            role="alert"
            className="mt-3 text-xs text-(--destructive)"
            data-testid="api-key-error"
          >
            {firstError}
          </p>
        )}

        <div className="flex justify-end gap-3 mt-6">
          <Button
            type="button"
            size="sm"
            data-alert-dialog-close
            data-testid="api-key-cancel"
            onClick={handleClose}
            className="bg-transparent border border-(--border) text-(--foreground) hover:bg-(--muted) rounded-xl"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            size="sm"
            loading={isSubmitting}
            data-testid="api-key-save"
            className="rounded-xl"
          >
            Save
          </Button>
        </div>
      </form>
    </AlertDialog>
  );
}

/**
 * Inline key icon — a stylised key, used as the dialog's leading glyph.
 *
 * Kept module-local because the dialog is the only consumer and the
 * existing `packages/ui/src/components/icons` set is curated for app-wide
 * affordances, not dialog decoration.
 */
function Key({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 1C9.243 1 7 3.243 7 6C7 7.347 7.595 8.554 8.535 9.39L3 14.926V20H7V16H9V14H11V12H12.5L14.5 10H15.84C18.18 10 20 8.18 20 5.84V5C20 2.243 17.757 1 15 1H12ZM12 3H15C16.654 3 18 4.346 18 5.84V5.84C18 7.077 17.077 8 15.84 8H13.672L9 12.672V14H7V16H5V14.156L10.61 8.535C9.46 7.726 9 6.438 9 6C9 4.346 10.346 3 12 3ZM12 5C11.448 5 11 5.448 11 6C11 6.552 11.448 7 12 7C12.552 7 13 6.552 13 6C13 5.448 12.552 5 12 5Z"></path>
    </svg>
  );
}
