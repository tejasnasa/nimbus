"use client";

/**
 * @module web/components/AiRefusalBanner
 * @description Composer-adjacent banner that surfaces an AI refusal reason and
 * a CTA. Two CTAs are possible:
 *
 * - `add-key` opens the {@link ApiKeyDialog}, wired by the parent so the dialog
 *   state lives with the surface that owns the credentials rather than inside
 *   the chat, which would die on tab switch.
 * - `manage-ai` covers refusals a new key does not fix, such as a workspace that
 *   has reached its monthly spend cap (`spend-cap-reached`). The parent opens the
 *   workspace's AI settings.
 *
 * Keys, models and the spend cap belong to the workspace's admins. A member who
 * sees a refusal can do nothing about it, so for them the banner drops the
 * button and says to ask a workspace admin instead of offering a control the
 * server would refuse.
 *
 * The banner is intentionally narrow and copy-only: no icons beyond the alert
 * glyph, no close button. The underlying refusal is permanent until someone acts,
 * and a dismissable banner would let people forget why the composer is disabled.
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
  /**
   * The server's refusal code (for example `spend-cap-reached`). Only used to
   * pick the button label; the message is already curated.
   */
  reason?: string | null;
  /** Whether the viewer may change the workspace's AI setup. Defaults to true. */
  canManage?: boolean;
};

/**
 * Renders the AI refusal banner above the chat composer.
 *
 * @param props.message - Server-curated refusal copy.
 * @param props.cta - Drives the button label and the parent's open-dialog call.
 * @param props.onCtaClickAction - The parent's handler.
 * @param props.ctaDisabled - Disables the CTA while another open dialog or an
 *                            in-flight request blocks the action.
 * @param props.reason - The refusal code, to label the manage button.
 * @param props.canManage - False for members, who get "ask a workspace admin"
 *                          instead of a button.
 */
export default function AiRefusalBanner({
  message,
  cta,
  onCtaClickAction,
  ctaDisabled = false,
  reason = null,
  canManage = true,
}: Props) {
  const ctaLabel =
    cta === "add-key"
      ? "Add API key"
      : reason === "spend-cap-reached"
        ? "Raise the cap"
        : "Manage AI";

  return (
    <div
      role="alert"
      data-testid="ai-refusal-banner"
      className="mx-2 mt-2 flex items-start gap-2 rounded-xl border border-(--destructive)/30 bg-(--destructive)/10 px-3 py-2 text-xs text-(--destructive)"
    >
      <Error className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p>{message}</p>
        {!canManage && (
          <p data-testid="ai-refusal-ask-admin" className="mt-0.5">
            Ask a workspace admin to sort this out.
          </p>
        )}
      </div>
      {canManage && (
        <Button
          size="xs"
          onClick={onCtaClickAction}
          disabled={ctaDisabled}
          data-testid="ai-refusal-cta"
          className="rounded-lg hover:cursor-pointer"
        >
          {ctaLabel}
        </Button>
      )}
    </div>
  );
}
