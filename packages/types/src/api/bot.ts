/**
 * Discriminated union returned by the NimbusBot AI pipeline.
 *
 * `generateBotResponse()` decides between the two variants:
 * - `reply`: a plain chat answer, emitted back to the room as a message.
 * - `create_document`: the bot's tool-call result — a new MARKDOWN or CANVAS
 *   document is generated from `prompt`, announced in chat via `chatMessage`,
 *   and surfaced to clients under tab label `label`.
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
      /** Chat message announcing the document creation to the room. */
      chatMessage: string;
    };
