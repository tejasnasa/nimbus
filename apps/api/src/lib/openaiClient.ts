/**
 * @module api/lib/openaiClient
 * @description OpenAI SDK singleton for canvas diagram generation
 * (`canvasGeneration.ts`, model via OPENAI_MODEL). Kept separate from the
 * Groq client because canvas uses OpenAI reasoning + structured JSON output.
 * Requires OPENAI_API_KEY.
 */
import OpenAI from "openai";

/** Shared OpenAI client — reuse instead of constructing per request. */
const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default openaiClient;
