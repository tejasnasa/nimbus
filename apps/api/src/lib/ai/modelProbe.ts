/**
 * @module api/lib/ai/modelProbe
 * @description Measures what a model id can do, for ids the registry and the
 * catalogue do not describe (a custom id the user typed).
 *
 * A basic `responses.create` runs first. If it fails the id is rejected with the
 * curated reason from {@link classifyProbeError} and nothing else runs. If it
 * passes, five narrower probes run in parallel, each with a 15 s timeout, no
 * retries and a tiny output cap:
 *
 *   - tools: one trivial function tool with `tool_choice: "required"`; a
 *     `function_call` in the output means `tools`;
 *   - json: `text.format: json_object`; output that parses means `jsonMode`;
 *   - streaming: `stream: true`; at least one event means `streaming`;
 *   - reasoning: `reasoning: { effort: "low" }` accepted means `reasoning`, then
 *     the same with `summary` accepted means `reasoningSummary`;
 *   - vision: a 1x1 PNG as `input_image` accepted means `vision`.
 *
 * A narrower probe that errors for any reason simply leaves its capability out.
 * Absence of evidence is treated as absence, which is the safe direction: the
 * model is then offered for fewer features, never more.
 *
 * @important The API key is passed to the SDK constructor and nowhere else. It
 *            is never logged, never placed in a result, and error text from the
 *            provider is discarded in favour of the curated messages, because
 *            some providers echo request parameters in their errors.
 */
import OpenAI from "openai";
import {
  featuresServedBy,
  type AiCapability,
  type AiFeature,
  type AiProviderSpec,
} from "@nimbus/types";
import { classifyProbeError, type ProbeRefusal } from "./probe";
import { resolveBaseUrl } from "./providers";

/** Per-call timeout for every probe request. */
export const MODEL_PROBE_TIMEOUT_MS = 15_000;

/** Output cap for probes that only need the request accepted. */
const PROBE_MAX_OUTPUT_TOKENS = 64;

/**
 * Output cap for the tool and JSON probes, which need the model to finish an
 * answer. Reasoning models spend their budget on reasoning first, so a small
 * cap ends the response as `incomplete` before any tool call or JSON appears and
 * the capability reads as absent.
 */
const PROBE_ANSWER_MAX_OUTPUT_TOKENS = 1024;

/** A 1x1 transparent PNG, the smallest image a vision model will accept. */
const ONE_PIXEL_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/** The slice of the SDK the probe uses; a scripted fake satisfies it in tests. */
export type ProbeClient = {
  responses: {
    create(params: Record<string, unknown>): Promise<unknown>;
  };
};

/** A measured capability set. */
export type ModelProbeSuccess = {
  readonly ok: true;
  readonly capabilities: AiCapability[];
  readonly servesFeatures: AiFeature[];
};

/** The probe's outcome: measured, or rejected with a curated reason. */
export type ModelProbeResult = ModelProbeSuccess | ProbeRefusal;

/** Options for {@link probeModel}. */
export type ProbeModelOptions = {
  /** Replaces the SDK client. Tests only. */
  client?: ProbeClient;
};

const outputItems = (response: unknown): Array<{ type?: string }> => {
  const output = (response as { output?: unknown } | null)?.output;
  return Array.isArray(output) ? (output as Array<{ type?: string }>) : [];
};

const outputText = (response: unknown): string => {
  const text = (response as { output_text?: unknown } | null)?.output_text;
  return typeof text === "string" ? text : "";
};

/** Whether a settled probe promise means the capability is present. */
const passed = (settled: PromiseSettledResult<boolean>): boolean =>
  settled.status === "fulfilled" && settled.value;

/**
 * Measures the capabilities of `modelId` on `provider` with the caller's key.
 *
 * @param provider - Provider whose base URL the client uses.
 * @param apiKey - The caller's plaintext key. Never logged or returned.
 * @param modelId - The id to measure.
 * @param options - Test seam for the client.
 * @returns The measured set and the features it serves, or a curated refusal.
 */
export async function probeModel(
  provider: AiProviderSpec,
  apiKey: string,
  modelId: string,
  options: ProbeModelOptions = {},
): Promise<ModelProbeResult> {
  const client: ProbeClient =
    options.client ??
    (new OpenAI({
      apiKey,
      baseURL: resolveBaseUrl(provider),
      timeout: MODEL_PROBE_TIMEOUT_MS,
      maxRetries: 0,
    }) as unknown as ProbeClient);

  const create = (extra: Record<string, unknown>) =>
    client.responses.create({
      model: modelId,
      max_output_tokens: PROBE_MAX_OUTPUT_TOKENS,
      ...extra,
    });

  try {
    await create({ input: "hi" });
  } catch (err) {
    return classifyProbeError(err, provider);
  }

  const [tools, json, streaming, reasoning, vision] = await Promise.allSettled([
    (async () => {
      const response = await create({
        max_output_tokens: PROBE_ANSWER_MAX_OUTPUT_TOKENS,
        input: "Call the ping tool.",
        tools: [
          {
            type: "function",
            name: "ping",
            description: "Returns pong.",
            parameters: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
            strict: false,
          },
        ],
        // `auto`, not `required`: DeepSeek rejects `required` in thinking mode,
        // and the app's own tool calls use `auto` too.
        tool_choice: "auto",
      });
      return outputItems(response).some((item) => item.type === "function_call");
    })(),
    (async () => {
      const response = await create({
        max_output_tokens: PROBE_ANSWER_MAX_OUTPUT_TOKENS,
        input: 'Return {"ok":true} as JSON.',
        text: { format: { type: "json_object" } },
      });
      try {
        JSON.parse(outputText(response));
        return true;
      } catch {
        return false;
      }
    })(),
    (async () => {
      const stream = (await create({ input: "hi", stream: true })) as
        | AsyncIterable<unknown>
        | undefined;
      if (!stream || typeof stream[Symbol.asyncIterator] !== "function") {
        return false;
      }
      for await (const event of stream) {
        void event;
        // One event is proof enough; stop the rest from being generated.
        (stream as { controller?: AbortController }).controller?.abort();
        return true;
      }
      return false;
    })(),
    (async () => {
      await create({ input: "hi", reasoning: { effort: "low" } });
      return true;
    })(),
    (async () => {
      await create({
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: "hi" },
              { type: "input_image", image_url: ONE_PIXEL_PNG },
            ],
          },
        ],
      });
      return true;
    })(),
  ]);

  const capabilities: AiCapability[] = [];
  if (passed(tools)) capabilities.push("tools");
  if (passed(json)) capabilities.push("jsonMode");
  if (passed(streaming)) capabilities.push("streaming");
  if (passed(reasoning)) {
    capabilities.push("reasoning");
    // Only worth asking once `reasoning` itself is accepted.
    try {
      await create({
        input: "hi",
        reasoning: { effort: "low", summary: "detailed" },
      });
      capabilities.push("reasoningSummary");
    } catch {
      // Rejected: the model takes `effort` but not `summary`.
    }
  }
  if (passed(vision)) capabilities.push("vision");

  return { ok: true, capabilities, servesFeatures: featuresServedBy(capabilities) };
}

/** How long a measured result is reused by the save that follows it. */
export const PROBE_CACHE_TTL_SECONDS = 10 * 60;

/** Redis key for one workspace's probe result for one model. Holds no key material. */
export const probeCacheKey = (
  workspaceId: string,
  providerId: string,
  modelId: string,
): string => `ai:probe:${workspaceId}:${providerId}:${modelId}`;
