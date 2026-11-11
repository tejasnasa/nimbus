/**
 * @module api/lib/meeting/modelText
 * @description Reading the text out of a Responses API result, whichever shape
 * the provider returned it in.
 */

/**
 * Pulls the response text from a completed Responses API result.
 *
 * @param response - The SDK result (or a stub shaped like one).
 * @returns The text, or an empty string when the result carries none.
 */
export function responseText(response: unknown): string {
  const direct = (response as { output_text?: unknown }).output_text;
  if (typeof direct === "string" && direct.length > 0) return direct;
  const output = (response as { output?: unknown }).output;
  if (!Array.isArray(output)) return "";
  for (const item of output as Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>) {
    if (item.type !== "message" || !item.content) continue;
    for (const part of item.content) {
      if (part.type === "output_text" && part.text) return part.text;
    }
  }
  return "";
}
