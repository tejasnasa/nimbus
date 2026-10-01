"use client";

/**
 * @module web/components/AiRefusalBanner
 * @description Composer-adjacent banner that surfaces an AI refusal reason and
 * a CTA. Two CTAs are possible:
 *
 * - `add-key` opens the {@link ApiKeyDialog} — wired by the parent so the dialog
 *   state lives at the panel/account-settings level rather than inside the
 *   chat, which would die on tab switch.
 * - `manage-ai` is reserved for cases that don't have a key fix (e.g. provider
 *   outage). Today nothing produces it; the type is there so a future failure
 *   can use it without refactoring this component.
 *
 * The banner is intentionally narrow and copy-only: no icons, no close button —
 * the underlying refusal is permanent until the user acts, and a dismissable
 * banner would let them forget why the composer is disabled.
 */
import Button from "@nimbus/ui/Button";
import Error from "@nimbus/ui/icons/Error";

type Props = {
  /** Human-readable refusal message (curated by the server, never a key). */
  message: string;
  /** Which CTA the banner should drive. */
  cta: "add-key" | "manage-ai";
  /** Called when the CTA is used. The parent opens the appropriate surface. */
  onCtaClickAction: () => void;
  /** True while the CTA action would block — disables the button. */
  ctaDisabled?: boolean;
};

/**
 * Renders the AI refusal banner above the chat composer.
 *
 * @param props.message - Server-curated refusal copy.
 * @param props.cta - Drives the button label and the parent's open-dialog call.
 * @param props.onCtaClick - The parent's handler (opens `ApiKeyDialog` etc.).
 * @param props.ctaDisabled - Disables the CTA while another open dialog or an
 *                            in-flight request blocks the action.
 */
export default function AiRefusalBanner({
  message,
  cta,
  onCtaClickAction,
  ctaDisabled = false,
}: Props) {
  const ctaLabel = cta === "add-key" ? "Add API key" : "Manage AI";

  return (
    <div
      role="alert"
      data-testid="ai-refusal-banner"
      className="mx-2 mt-2 flex items-start gap-2 rounded-xl border border-(--destructive)/30 bg-(--destructive)/10 px-3 py-2 text-xs text-(--destructive)"
    >
      <Error className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p>{message}</p>
      </div>
      <Button
        size="xs"
        onClick={onCtaClickAction}
        disabled={ctaDisabled}
        data-testid="ai-refusal-cta"
        className="rounded-lg hover:cursor-pointer"
      >
        {ctaLabel}
      </Button>
    </div>
  );
}
