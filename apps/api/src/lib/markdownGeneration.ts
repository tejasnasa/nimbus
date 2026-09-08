/**
 * @module api/lib/markdownGeneration
 * @description Streaming Groq Markdown generator: system prompt frames the
 * model as a technical writer (headings, lists, code blocks, tables,
 * blockquotes), then each `output_text.delta` is appended and forwarded via
 * `onToken` for live socket relay, with reasoning deltas on `onThinking`.
 * Requires GROQ_MODEL.
 */
import groqClient from "./groqClient";

/**
 * Streams a full Markdown document for a prompt.
 *
 * @param prompt - User's description of the desired document.
 * @param label - Document title injected into the system prompt.
 * @param onToken - Called per text delta (socket relay) as content streams.
 * @param onThinking - Called per reasoning delta (defaults to no-op).
 * @returns The accumulated `fullContent` once the stream completes.
 */
export async function generateMarkdownDocument(
  prompt: string,
  label: string,
  onToken: (token: string) => void,
  onThinking: (token: string) => void = () => {},
): Promise<{ fullContent: string }> {
  const systemPrompt = `You are an expert technical writer and document generator.
Generate a rich, detailed, and highly professional Markdown document based on the user's prompt.
Include clear headings, bulleted and numbered lists, code blocks (with syntax highlighting), tables where appropriate, blockquotes, and bold/italic text.
Ensure the content is comprehensive, well-structured, and ready to read.

Document Title: ${label}`;

  const stream = await groqClient.responses.create({
    model: process.env.GROQ_MODEL!,
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
      onThinking(event.delta);
    }
  }

  return { fullContent };
}
