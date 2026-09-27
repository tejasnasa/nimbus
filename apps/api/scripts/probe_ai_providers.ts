/**
 * @module api/scripts/probe_ai_providers
 * @description Phase 0 transport probe. Answers, against the **real** provider
 * APIs, the five questions the BYOK design depends on — and answers them by
 * exercising the exact request shapes the three call sites build, because a
 * probe that sends a simpler request verifies the wrong thing.
 *
 * Kept afterwards as an ops diagnostic: this is the tool to reach for when a
 * deployed free tier misbehaves.
 *
 * Run from `apps/api` so `dotenv/config` picks up `apps/api/.env`:
 *
 *   npx tsx scripts/probe_ai_providers.ts                 # every provider with a key
 *   npx tsx scripts/probe_ai_providers.ts --json          # machine-readable
 *   npx tsx scripts/probe_ai_providers.ts --provider groq # one provider
 *   npx tsx scripts/probe_ai_providers.ts --canvas        # add the real-pipeline check
 *
 * @important Reads `process.env` directly and must never import `src/lib/env`,
 *            which requires a full application environment and would make the
 *            probe unusable in the situation it exists for.
 *
 * @important Never prints a key. Values are referred to by length and last four
 *            characters only.
 */
import "dotenv/config";
import OpenAI from "openai";
import {
  AI_PROVIDERS,
  modelById,
  type AiProviderId,
  type AiProviderSpec,
} from "../../../packages/types/src/ai/providers";

// ── argv ────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const wantCanvas = argv.includes("--canvas");
const only = argv.find((a) => a.startsWith("--provider="))?.split("=")[1]
  ?? (argv.includes("--provider") ? argv[argv.indexOf("--provider") + 1] : undefined);

/** Which operator key supplies each provider. DeepSeek prefers `AI_API_KEY`. */
const KEY_VARS: Record<AiProviderId, string[]> = {
  deepseek: ["AI_API_KEY", "DEEPSEEK_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  groq: ["GROQ_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
};

/** The operator's model override for a provider, where one exists. */
const MODEL_VARS: Record<AiProviderId, string[]> = {
  deepseek: ["AI_MODEL"],
  openai: ["OPENAI_MODEL"],
  groq: ["GROQ_MODEL"],
  openrouter: [],
};

function resolveKey(id: AiProviderId): string | undefined {
  for (const v of KEY_VARS[id]) {
    const val = process.env[v];
    if (val && val.trim()) return val.trim();
  }
  return undefined;
}

/**
 * Keys are resolved **once, at module load**, before anything can mutate the
 * environment.
 *
 * @important The real-pipeline check rewrites `OPENAI_API_KEY`/`OPENAI_BASE_URL`
 *            to point the SDK at the provider under test. Resolving a key lazily
 *            would then hand the OpenAI provider the DeepSeek key whenever
 *            DeepSeek is probed first — a defect that would surface as an OpenAI
 *            authentication failure rather than as a probe bug.
 */
const KEYS: Record<AiProviderId, string | undefined> = {
  deepseek: resolveKey("deepseek"),
  openai: resolveKey("openai"),
  groq: resolveKey("groq"),
  openrouter: resolveKey("openrouter"),
};

function resolveModel(provider: AiProviderSpec): string {
  for (const v of MODEL_VARS[provider.id]) {
    const val = process.env[v];
    if (val && val.trim()) return val.trim();
  }
  return provider.defaultModel;
}

/** A key is never printed; this is the only representation that reaches output. */
const describeKey = (k: string) => `len ${k.length}, …${k.slice(-4)}`;

// ── result shapes ───────────────────────────────────────────────────────────

type Outcome = "pass" | "fail" | "skip";
type Check = { name: string; outcome: Outcome; detail: string };
type Report = {
  provider: AiProviderId;
  model: string;
  key: string;
  checks: Check[];
};

const pass = (name: string, detail = ""): Check => ({ name, outcome: "pass", detail });
const fail = (name: string, detail: string): Check => ({ name, outcome: "fail", detail });
const skip = (name: string, detail = ""): Check => ({ name, outcome: "skip", detail });

/** Provider errors carry status codes and sometimes echo request params, so trim hard. */
function brief(err: unknown): string {
  const e = err as { status?: number; message?: string; name?: string };
  const status = e?.status ? `HTTP ${e.status} ` : "";
  const msg = (e?.message ?? String(err)).replace(/\s+/g, " ").slice(0, 200);
  return `${status}${msg}`;
}

// ── the checks ──────────────────────────────────────────────────────────────

const TIMEOUT_MS = 120_000;

/**
 * 1. The transport itself: does `responses.create` reach this base URL, and does
 *    the model answer? This is what catches a base URL missing `/v1`, which
 *    fails as a 404 at request time rather than at import.
 */
async function checkTransport(
  client: OpenAI,
  provider: AiProviderSpec,
  model: string,
): Promise<Check> {
  const body: Record<string, unknown> = { model, input: "Reply with exactly: OK" };
  if (provider.supportsReasoning) body.reasoning = { effort: "low" };
  try {
    const r = (await client.responses.create(body as never)) as {
      output_text?: string;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = (r.output_text ?? "").trim();
    if (!text) return fail("transport", "200 but empty output_text");
    const u = r.usage;
    const tokens = u ? `, ${u.input_tokens ?? 0}/${u.output_tokens ?? 0} tok` : "";
    return pass("transport", `output_text=${JSON.stringify(text.slice(0, 40))}${tokens}`);
  } catch (err) {
    return fail("transport", brief(err));
  }
}

/**
 * 2. `bot.ts`'s shape: a tool with `strict: true` and — as the code actually
 *    declares it — **no `additionalProperties: false`**. OpenAI's strict mode
 *    rejects exactly that, so whether this passes decides whether the missing
 *    key is a live bug or a harmless omission on this provider.
 */
async function checkTools(client: OpenAI, provider: AiProviderSpec, model: string): Promise<Check> {
  const tools = [
    {
      type: "function" as const,
      name: "create_document",
      description: "Create a new document in the workspace when the user asks for one.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["MARKDOWN", "CANVAS"],
            description: "MARKDOWN for text documents, CANVAS for diagrams/flowcharts/wireframes",
          },
          label: { type: "string", description: "A concise title for the document" },
          prompt: { type: "string", description: "Detailed description of what the document should contain" },
        },
        required: ["type", "label", "prompt"],
      },
    },
  ];

  try {
    const r = (await client.responses.create({
      model,
      tools,
      input: [
        { role: "user", content: "Please create a flowchart for a login flow." },
      ],
      instructions:
        "You are Nimbus Bot. Use the create_document tool when the user asks for a document.",
      max_output_tokens: 1000,
    } as never)) as { output?: Array<{ type?: string; name?: string }>; output_text?: string };

    const call = r.output?.find((i) => i.type === "function_call");
    if (call) return pass("tools (strict, no additionalProperties)", `returned function_call: ${call.name}`);
    return fail(
      "tools (strict, no additionalProperties)",
      `no function_call in output; text=${JSON.stringify((r.output_text ?? "").slice(0, 80))}`,
    );
  } catch (err) {
    return fail("tools (strict, no additionalProperties)", brief(err));
  }
}

/** 3. `markdownGeneration.ts`'s shape: streaming text deltas. */
async function checkStreaming(
  client: OpenAI,
  provider: AiProviderSpec,
  model: string,
): Promise<Check> {
  const body: Record<string, unknown> = {
    model,
    stream: true,
    instructions: "You are a helpful writer.",
    input: "Write two short sentences about rivers.",
  };
  if (provider.supportsReasoning) body.reasoning = { effort: "low" };

  try {
    const stream = (await client.responses.create(body as never)) as AsyncIterable<{
      type?: string;
      delta?: string;
    }>;
    let text = "";
    const kinds = new Set<string>();
    for await (const ev of stream) {
      if (ev.type) kinds.add(ev.type);
      if (ev.type === "response.output_text.delta") text += ev.delta ?? "";
    }
    if (!text.trim()) {
      return fail("streaming", `deltas never arrived; events seen: ${[...kinds].join(",") || "none"}`);
    }
    return pass("streaming", `${text.trim().length} chars from deltas`);
  } catch (err) {
    return fail("streaming", brief(err));
  }
}

/**
 * Minimal brace-matching salvage, mirroring what the production pipeline's
 * tolerant extractor does. Needed here because a model that runs out of output
 * tokens mid-object is *expected*, not exceptional — the first run of this probe
 * failed on exactly that, which is the reason `canvasGeneration.ts` has
 * `trySalvageIncompleteJson` in the first place.
 */
function tolerantJson(text: string): unknown | undefined {
  const cleaned = text.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    /* fall through to brace matching */
  }
  const open = cleaned.indexOf("{");
  const close = cleaned.lastIndexOf("}");
  if (open !== -1 && close > open) {
    try {
      return JSON.parse(cleaned.slice(open, close + 1));
    } catch {
      /* genuinely unparseable */
    }
  }
  return undefined;
}

/**
 * 4. `canvasGeneration.ts`'s shape: streaming + `text.format: json_object` +
 *    `reasoning: { effort: "low", summary: "detailed" }`.
 *
 *    This measures whether the provider *honours the structured-output parameter
 *    and streams reasoning*; structural validation is deliberately tolerant,
 *    because the authoritative test is the real-pipeline check below, which runs
 *    the production extractor end to end. The `summary` field is the specific
 *    risk: DeepSeek ignores unsupported parameters, so a dropped summary would
 *    not error — it would quietly empty the generation log overlay.
 */
async function checkCanvasShape(
  client: OpenAI,
  provider: AiProviderSpec,
  model: string,
): Promise<Check> {
  // Send `summary` only where the registry says the model takes it. That matters
  // because `canvasGeneration.ts` sends both fields unconditionally, so a model
  // without `reasoningSummary` needs the summary dropped — and measuring that
  // case is the point. Groq's gpt-oss models are the measured example: they
  // accept `effort` and reject `summary` with a 400.
  const spec = modelById(provider, model);
  const takesSummary = spec?.capabilities.includes("reasoningSummary") ?? false;

  const withSummary: Record<string, unknown> = {
    model,
    stream: true,
    instructions:
      "You are a diagram generator. Return a JSON object with a `nodes` array (each with `id` and `label`) and an `edges` array (each with `from` and `to`).",
    input: "Create a diagram as a JSON object for:\nA login flow with email, password and MFA.",
    text: { format: { type: "json_object" } },
    max_output_tokens: 2048,
  };
  if (provider.supportsReasoning) {
    withSummary.reasoning = takesSummary
      ? { effort: "low", summary: "detailed" }
      : { effort: "low" };
  }

  const run = async (body: Record<string, unknown>) => {
    const stream = (await client.responses.create(body as never)) as AsyncIterable<{
      type?: string;
      delta?: string;
      response?: {
        output_parsed?: unknown;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
    }>;
    let text = "";
    let reasoning = 0;
    let parsed: unknown;
    let usage: { input_tokens?: number; output_tokens?: number } | undefined;
    for await (const ev of stream) {
      if (ev.type === "response.output_text.delta") text += ev.delta ?? "";
      if (ev.type === "response.reasoning_text.delta") reasoning += (ev.delta ?? "").length;
      if (ev.response?.output_parsed) parsed = ev.response.output_parsed;
      if (ev.response?.usage) usage = ev.response.usage;
    }
    return { text, reasoning, parsed, usage };
  };

  try {
    let { text, reasoning, parsed, usage } = await run(withSummary);
    let note = takesSummary
      ? "reasoning.summary accepted"
      : provider.supportsReasoning
        ? "reasoning.summary omitted (model lacks the capability)"
        : "no reasoning sent (provider lacks support)";

    // A provider may reject `summary` outright. Retry without it so the report
    // distinguishes "no summary support" from "no structured output at all".
    if (!text.trim() && provider.supportsReasoning) {
      const retry = { ...withSummary };
      delete retry.reasoning;
      ({ text, reasoning, parsed, usage } = await run(retry));
      note = "summary:detailed REFUSED (retried without reasoning)";
    }

    if (!text.trim()) return fail("canvas shape", `no output_text; ${note}`);

    // Did the provider honour `text.format`? The first non-space character is
    // the observable signal — a prose preamble means the parameter was ignored.
    const honoured = text.trimStart().startsWith("{");
    const json = parsed ?? tolerantJson(text);
    const nodes = (json as { nodes?: unknown[] })?.nodes;
    const edges = (json as { edges?: unknown[] })?.edges;

    const shape = Array.isArray(nodes) && Array.isArray(edges)
      ? `${nodes.length} nodes / ${edges.length} edges`
      : "unparseable (see the real-pipeline check)";

    const reasoningNote = provider.supportsReasoning
      ? `, ${reasoning} reasoning chars`
      : "";
    // The number that prices the free tier: what one document generation costs
    // the operator, in the provider's own token accounting.
    const usageNote = usage
      ? `, ${usage.input_tokens ?? 0} in / ${usage.output_tokens ?? 0} out tok`
      : ", usage not reported";

    if (!honoured && !parsed) {
      return fail("canvas shape", `json_object ignored — output began with prose; ${note}`);
    }
    if (!Array.isArray(nodes)) {
      // Not a failure: truncated output is the documented reason the production
      // extractor exists. The real-pipeline check is what decides viability.
      return pass("canvas shape", `json_object honoured, ${shape}; ${note}${reasoningNote}${usageNote}`);
    }
    return pass("canvas shape", `${shape}, json_object honoured, ${note}${reasoningNote}${usageNote}`);
  } catch (err) {
    return fail("canvas shape", brief(err));
  }
}

/**
 * 5. Multi-turn history replay. Two third-party reports describe DeepSeek
 *    rejecting multi-turn requests with
 *    `400 The reasoning_text in the thinking mode must be passed back to the API`.
 *    `bot.ts` sends `input: history`, so this is that exact shape.
 */
async function checkMultiTurn(
  client: OpenAI,
  provider: AiProviderSpec,
  model: string,
): Promise<Check> {
  const body: Record<string, unknown> = {
    model,
    instructions: "You are Nimbus Bot in a workspace chat.",
    input: [
      { role: "user", content: "Teja: what should we do about the cache?" },
      { role: "assistant", content: "Consider a short TTL and a stampede guard." },
      { role: "user", content: "Teja: summarise that in one line." },
    ],
    max_output_tokens: 500,
  };
  if (provider.supportsReasoning) body.reasoning = { effort: "low" };

  try {
    const r = (await client.responses.create(body as never)) as { output_text?: string };
    const text = (r.output_text ?? "").trim();
    if (!text) return fail("multi-turn history", "200 but empty output_text");
    return pass("multi-turn history", `${text.length} chars, no reasoning_text echo required`);
  } catch (err) {
    return fail("multi-turn history", brief(err));
  }
}

/**
 * 6. The strongest check available: run the **real** `generateCanvasDocument`
 *    against this provider and see whether the production pipeline yields
 *    elements. `openaiClient.ts` passes no `baseURL`, so the SDK's
 *    `OPENAI_BASE_URL` environment variable redirects it — which means this
 *    needs no code change and no mock.
 *
 *    Must run after the environment is rewritten and before anything imports the
 *    module, since the client is constructed at import time.
 */
async function checkRealCanvasPipeline(
  provider: AiProviderSpec,
  key: string,
  model: string,
): Promise<Check> {
  process.env.OPENAI_API_KEY = key;
  process.env.OPENAI_BASE_URL = provider.baseUrl;
  process.env.OPENAI_MODEL = model;

  try {
    const mod = await import("../src/lib/canvasGeneration");
    let reasoningChars = 0;
    const { canvasData, thinking } = await mod.generateCanvasDocument(
      "a login flow with email, password and MFA",
      "Login Flow",
      (t) => { reasoningChars += t.length; },
      () => {},
    );
    if (!Array.isArray(canvasData) || canvasData.length === 0) {
      return fail("REAL canvas pipeline", "returned zero elements");
    }
    return pass(
      "REAL canvas pipeline",
      `${canvasData.length} elements, ${reasoningChars} reasoning chars, thinking ${thinking.length}b`,
    );
  } catch (err) {
    return fail("REAL canvas pipeline", brief(err));
  }
}

// ── driver ──────────────────────────────────────────────────────────────────

async function probeProvider(id: AiProviderId, singleRun: boolean): Promise<Report> {
  const provider = AI_PROVIDERS[id];
  const model = resolveModel(provider);
  const key = KEYS[id];
  const checks: Check[] = [];

  if (!key) {
    return {
      provider: id,
      model,
      key: "(none)",
      checks: [skip("all", `no key in ${KEY_VARS[id].join(" / ")}`)],
    };
  }

  const client = new OpenAI({
    apiKey: key,
    baseURL: provider.baseUrl,
    timeout: TIMEOUT_MS,
    maxRetries: 0,
  });

  // Ordered cheapest-first so an early failure short-circuits the expensive ones.
  checks.push(await checkTransport(client, provider, model));
  if (checks[0].outcome === "fail") {
    checks.push(skip("tools", "transport failed"));
    checks.push(skip("streaming", "transport failed"));
    checks.push(skip("canvas shape", "transport failed"));
    checks.push(skip("multi-turn history", "transport failed"));
  } else {
    checks.push(await checkTools(client, provider, model));
    checks.push(await checkStreaming(client, provider, model));
    checks.push(await checkCanvasShape(client, provider, model));
    checks.push(await checkMultiTurn(client, provider, model));
  }

  if (wantCanvas) {
    // @important The real-pipeline check dynamically imports
    //            `src/lib/canvasGeneration`, and that module constructs its
    //            OpenAI client at import time. The module cache therefore pins
    //            whichever provider was imported first, so running this against
    //            several providers in one process would silently report the
    //            first one's result for all of them. One provider per run.
    if (singleRun) {
      checks.push(await checkRealCanvasPipeline(provider, key, model));
    } else {
      checks.push(
        skip("REAL canvas pipeline", "--canvas needs a single --provider per run, see the module note"),
      );
    }
  }

  return { provider: id, model, key: describeKey(key), checks };
}

async function main() {
  const ids = (only ? [only as AiProviderId] : (Object.keys(AI_PROVIDERS) as AiProviderId[]))
    .filter((id) => AI_PROVIDERS[id]);

  const reports: Report[] = [];
  for (const id of ids) reports.push(await probeProvider(id, ids.length === 1));

  if (asJson) {
    process.stdout.write(JSON.stringify({ probedAt: new Date().toISOString(), reports }, null, 2) + "\n");
    return;
  }

  for (const r of reports) {
    console.log(`\n=== ${AI_PROVIDERS[r.provider].label}  (${r.provider}) ===`);
    console.log(`    model: ${r.model}    key: ${r.key}    baseUrl: ${AI_PROVIDERS[r.provider].baseUrl}`);
    for (const c of r.checks) {
      const tag = c.outcome === "pass" ? "PASS" : c.outcome === "fail" ? "FAIL" : "skip";
      console.log(`    [${tag}] ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
    }
  }

  const all = reports.flatMap((r) => r.checks);
  const passed = all.filter((c) => c.outcome === "pass").length;
  const failed = all.filter((c) => c.outcome === "fail").length;
  console.log(`\n${passed} passed, ${failed} failed, ${all.filter((c) => c.outcome === "skip").length} skipped`);
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error("probe crashed:", err);
  process.exitCode = 1;
});
