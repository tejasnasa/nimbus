/**
 * Matches a mention of the chat assistant: `@nimbus`, or the original
 * `@nimbusbot`, in any case. The trailing word boundary keeps `@nimbusapp` and
 * `@nimbuses` from counting. Carries no `g` flag, so `.test()` is stateless.
 *
 * @important The one definition every mention check shares. The old
 *            `@nimbusbot` spelling stays matched because earlier messages and
 *            habits still use it; do not narrow it to the new name alone.
 */
export const BOT_MENTION = /@nimbus(?:bot)?\b/i;

/**
 * Whether a chat message addresses the assistant.
 *
 * @param text - Raw message content.
 * @returns True when `text` contains a {@link BOT_MENTION}.
 */
export function mentionsBot(text: string): boolean {
  return BOT_MENTION.test(text);
}

/**
 * Discriminated union returned by the Nimbus chat AI pipeline.
 *
 * `generateBotResponse()` decides between three variants:
 * - `reply`: a plain chat answer, emitted back to the room as a message.
 * - `create_document`: the bot's tool-call result — a new MARKDOWN or CANVAS
 *   document is generated from `prompt`, announced in chat via `chatMessage`,
 *   and surfaced to clients under tab label `label`.
 * - `refused`: the user's entitlement check failed — no key, free tier
 *   exhausted, or feature unavailable. The chat handler emits `ai:refused` to
 *   the asking socket only, never broadcasts, and posts no chat message.
 *
 * @important Adding `refused` is a deliberate breaking change. The exhaustive
 *            switch in `apps/api/src/socket/chat.ts` fails `tsc` if a future
 *            variant is added without a handler — the refusal branch must be
 *            written, not remembered.
 */
export type BotResult =
  | { kind: "reply"; content: string }
  | {
      kind: "create_document";
      type: "MARKDOWN" | "CANVAS";
      /** Tab title shown for the generated document. */
      label: string;
      /** Prompt forwarded to the markdown/canvas generation pipeline. */
      prompt: string;
      /**
       * The user wants the attached image turned into a diagram. Only honoured
       * for a message that carries an image, and only as a CANVAS.
       */
      fromImage?: boolean;
      /** Chat message announcing the document creation to the room. */
      chatMessage: string;
    }
  | {
      kind: "refused";
      /** Which feature the refusal applies to. */
      feature: "chat" | "markdown" | "canvas" | "vision";
      /** Stable, curated reason code from `AiRefusalReason`. */
      reason: string;
      /** User-visible message. Never contains a key. */
      message: string;
      /** UI affordance the refusal should drive. */
      cta: "add-key" | "manage-ai" | null;
    };
