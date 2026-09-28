/**
 * @module api/lib/markdownGeneration
 * @description Streaming Markdown generator: system prompt frames the model as
 * a technical writer (headings, lists, code blocks, tables, blockquotes), then
 * each `output_text.delta` is appended and forwarded via `onToken` for live
 * socket relay, with reasoning deltas on `onThinking`.
 *
 * The function takes a pre-resolved {@link AiClientHandle} rather than reading
 * a module-level singleton — the handle is what makes per-user (BYOK) and
 * per-deployment (free tier) keys actually reach the call site without env
 * reads at import time.
 */
import type { AiClientHandle } from "./ai/clientFactory";

/** Options for {@link generateMarkdownDocument}. */
export type GenerateMarkdownDocumentOptions = {
  /** User's description of the desired document. */
  prompt: string;
  /** Document title injected into the system prompt. */
  label: string;
  /** Called per text delta (socket relay) as content streams. */
  onToken: (token: string) => void;
  /** Called per reasoning delta (defaults to no-op). */
  onThinking?: (token: string) => void;
  /** The pre-resolved SDK client handle. The caller owns entitlement. */
  handle: AiClientHandle;
};

/**
 * Streams a full Markdown document for a prompt.
 *
 * @param options - See {@link GenerateMarkdownDocumentOptions}. The handle is
 *                  the seam that lets a BYOK user pay for their own document
 *                  generation rather than silently using the operator's key.
 * @returns The accumulated `fullContent` once the stream completes.
 */
export async function generateMarkdownDocument(
  options: GenerateMarkdownDocumentOptions,
): Promise<{ fullContent: string }> {
  const { prompt, label, onToken, onThinking, handle } = options;
  const appendThinking = onThinking ?? (() => {});

  const systemPrompt = `You are an expert technical writer and document generator.
Generate a rich, detailed, and highly professional Markdown document based on the user's prompt.
Include clear headings, bulleted and numbered lists, code blocks (with syntax highlighting), tables where appropriate, blockquotes, and bold/italic text.
Ensure the content is comprehensive, well-structured, and ready to read.

Document Title: ${label}`;

  const stream = await handle.client.responses.create({
    model: handle.modelId,
    stream: true,
    instructions: systemPrompt,
    input: prompt,
  });

  let fullContent = "";
  for await (const event of stream) {
    if (event.type === "response.output_text.delta" && event.delta) {
      fullContent += event.delta;
      onToken(event.delta);
    }

    if (event.type === "response.reasoning_text.delta" && event.delta) {
      appendThinking(event.delta);
    }
  }

  return { fullContent };
}
