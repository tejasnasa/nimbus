/**
 * @module api/lib/groqClient
 * @description Groq LLM singleton behind the OpenAI-compatible SDK endpoint.
 * Used by the NimbusBot pipeline (`bot.ts`) and Markdown generation
 * (`markdownGeneration.ts`). Requires GROQ_API_KEY (model via GROQ_MODEL).
 */
import OpenAI from "openai";

/** Shared Groq client — reuse instead of constructing per request. */
const groqClient = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1",
});

export default groqClient;
