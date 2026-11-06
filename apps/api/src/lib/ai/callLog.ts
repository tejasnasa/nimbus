/**
 * @module api/lib/ai/callLog
 * @description The per-workspace call log: one `AiCall` row for every model
 * call, successful or not, with token or audio usage, latency and an estimated
 * cost. It feeds the admin Usage tab and the monthly spend cap.
 *
 * Three entry points cover the shapes a call takes:
 *   - {@link withAiCall} wraps a request/response call;
 *   - {@link startAiCall} returns a `finish`/`fail` pair for a streaming call,
 *     whose usage arrives on the final event;
 *   - {@link recordAiRefusal} records a resolver refusal that never reached a
 *     provider.
 *
 * @important Logging must never fail the request it describes. {@link
 *            recordAiCall} swallows every error and logs only the error's name
 *            and code, never its message: a database error can quote the
 *            values it was inserting.
 *
 * @important Provider error text is never stored. A failed call keeps only a
 *            curated `errorReason` (`invalid-key`, `provider-error`, `timeout`,
 *            `parse-failed`, `cancelled`), because that text can echo request
 *            parameters, including a key.
 */
import { prisma } from "@nimbus/db";
import type { AiFeature, AiModelPricing } from "@nimbus/types";
import { estimateCostUsd } from "@nimbus/utils";
import { pubClient } from "../redis";
import { classifyClientError } from "./clientFactory";

/** Who and what a call was, known before it runs. */
export type AiCallMeta = {
  readonly workspaceId: string | null;
  readonly userId: string | null;
  readonly feature: AiFeature;
  readonly providerId: string;
  readonly modelId: string;
  readonly source: "byok" | "free";
  /** List prices of the model, when it has them. Drives the cost estimate. */
  readonly pricing?: AiModelPricing;
  /** The workspace credential that paid, so its `lastUsedAt` can be touched. */
  readonly credentialId?: string;
};

/** What a call consumed. Supply only what applies. */
export type AiCallUsage = {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  audioSeconds?: number;
  characters?: number;
};

/** The curated reasons a call can fail for. */
export type AiCallErrorReason =
  | "invalid-key"
  | "provider-error"
  | "timeout"
  | "parse-failed"
  | "cancelled";

/**
 * An error a pipeline throws to give its failure a specific curated reason
 * (for example, model output that did not parse).
 */
export class AiCallError extends Error {
  readonly reason: AiCallErrorReason;

  constructor(reason: AiCallErrorReason, message: string = reason) {
    super(message);
    this.name = "AiCallError";
    this.reason = reason;
  }
}

/** A row ready to insert. */
export type AiCallEntry = AiCallMeta & {
  readonly status: "OK" | "ERROR" | "REFUSED" | "CANCELLED";
  readonly errorReason?: string | null;
  readonly usage?: AiCallUsage;
  readonly latencyMs: number;
  /** Overrides the registry estimate when the provider reported a real cost. */
  readonly costUsd?: number | null;
};

/** Collaborators the writer uses. Defaults to the live ones. */
export type CallLogDeps = {
  readonly db?: Pick<typeof prisma, "aiCall" | "workspaceAiCredential">;
  readonly redis?: Pick<typeof pubClient, "set">;
};

/** How often a credential's `lastUsedAt` may be written. */
export const LAST_USED_GATE_SECONDS = 60;

/**
 * Estimates a call's cost from its usage and the model's list prices.
 *
 * Reasoning tokens are part of the output count already, so they are not added.
 *
 * @returns USD, or `null` when the model has no price or nothing was billable.
 */
export function estimateCallCost(
  pricing: AiModelPricing | undefined,
  usage: AiCallUsage,
): number | null {
  return estimateCostUsd(pricing ? { pricing } : undefined, {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    audioMinutes:
      usage.audioSeconds === undefined ? undefined : usage.audioSeconds / 60,
    characters: usage.characters,
  });
}

/** A loggable tag for an error that never includes its message. */
function errorTag(err: unknown): string {
  if (!err || typeof err !== "object") return "unknown";
  const e = err as { name?: unknown; code?: unknown };
  return [e.name, e.code]
    .filter((part): part is string => typeof part === "string")
    .join("/") || "unknown";
}

/**
 * Inserts one call-log row. Never throws.
 *
 * Also touches the paying credential's `lastUsedAt`, at most once a minute per
 * credential (a Redis `SET NX EX 60` gate), so a busy chat does not become a
 * write per message.
 *
 * @param entry - The call to record.
 * @param deps - Test seams.
 */
export async function recordAiCall(
  entry: AiCallEntry,
  deps: CallLogDeps = {},
): Promise<void> {
  const db = deps.db ?? prisma;
  const usage = entry.usage ?? {};
  const costUsd =
    entry.costUsd !== undefined
      ? entry.costUsd
      : entry.status === "OK" || entry.status === "CANCELLED"
        ? estimateCallCost(entry.pricing, usage)
        : null;

  try {
    await db.aiCall.create({
      data: {
        workspaceId: entry.workspaceId,
        userId: entry.userId,
        feature: entry.feature.toUpperCase() as Uppercase<AiFeature>,
        providerId: entry.providerId,
        modelId: entry.modelId,
        source: entry.source === "byok" ? "BYOK" : "FREE",
        status: entry.status,
        errorReason: entry.errorReason ?? null,
        inputTokens: usage.inputTokens ?? null,
        outputTokens: usage.outputTokens ?? null,
        reasoningTokens: usage.reasoningTokens ?? null,
        audioSeconds: usage.audioSeconds ?? null,
        characters: usage.characters ?? null,
        latencyMs: Math.max(0, Math.round(entry.latencyMs)),
        costUsd,
      },
    });
  } catch (err) {
    console.error(`[ai] Could not write the call log (${errorTag(err)}).`);
    return;
  }

  if (entry.status === "OK" && entry.credentialId) {
    await touchCredential(entry.credentialId, db, deps.redis ?? pubClient);
  }
}

/** Stamps `lastUsedAt` behind the once-a-minute gate. Never throws. */
async function touchCredential(
  credentialId: string,
  db: NonNullable<CallLogDeps["db"]>,
  redis: NonNullable<CallLogDeps["redis"]>,
): Promise<void> {
  try {
    const won = await redis.set(
      `ai:lastused:${credentialId}`,
      "1",
      "EX",
      LAST_USED_GATE_SECONDS,
      "NX",
    );
    if (won !== "OK") return;
    await db.workspaceAiCredential.updateMany({
      where: { id: credentialId },
      data: { lastUsedAt: new Date() },
    });
  } catch (err) {
    console.error(`[ai] Could not stamp credential use (${errorTag(err)}).`);
  }
}

/**
 * Reads token usage from a Responses API result (or a `response.completed`
 * event's `response`). Anything absent stays undefined.
 */
export function usageFromResponse(response: unknown): AiCallUsage {
  const usage = (response as { usage?: unknown } | null | undefined)?.usage as
    | {
        input_tokens?: unknown;
        output_tokens?: unknown;
        output_tokens_details?: { reasoning_tokens?: unknown };
      }
    | undefined;
  if (!usage || typeof usage !== "object") return {};
  const num = (v: unknown) => (typeof v === "number" ? v : undefined);
  return {
    inputTokens: num(usage.input_tokens),
    outputTokens: num(usage.output_tokens),
    reasoningTokens: num(usage.output_tokens_details?.reasoning_tokens),
  };
}

/** Whether a thrown value is a caller-initiated abort. */
function isAbort(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: unknown }).name;
  return name === "AbortError" || name === "APIUserAbortError";
}

/** Whether a thrown value is a transport timeout. */
function isTimeout(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: unknown }).name;
  return name === "APIConnectionTimeoutError" || name === "TimeoutError";
}

/**
 * Classifies a failure into a status and a curated reason.
 *
 * @returns `CANCELLED` for an abort; otherwise `ERROR` with `timeout`,
 *          `parse-failed`, `invalid-key` or `provider-error`.
 */
export function classifyCallFailure(err: unknown): {
  status: "ERROR" | "CANCELLED";
  reason: AiCallErrorReason;
} {
  if (isAbort(err)) return { status: "CANCELLED", reason: "cancelled" };
  if (err instanceof AiCallError) return { status: "ERROR", reason: err.reason };
  if (isTimeout(err)) return { status: "ERROR", reason: "timeout" };
  const classified = classifyClientError(err);
  return {
    status: "ERROR",
    reason: classified.kind === "invalid-key" ? "invalid-key" : "provider-error",
  };
}

/** A started call, to be closed exactly once. */
export type StartedAiCall = {
  /** Records success with the usage the final event reported. */
  finish(usage?: AiCallUsage, deps?: CallLogDeps): Promise<void>;
  /** Records the failure (or cancellation) of the call. */
  fail(err: unknown, deps?: CallLogDeps): Promise<void>;
};

/**
 * Starts timing a call whose result arrives later, such as a stream.
 *
 * Whichever of `finish` and `fail` runs first records the row; later calls do
 * nothing, so a `finally` block cannot double-log.
 *
 * @param meta - Who and what the call is.
 * @param now - The clock. Tests only.
 */
export function startAiCall(
  meta: AiCallMeta,
  now: () => number = Date.now,
): StartedAiCall {
  const startedAt = now();
  let closed = false;

  return {
    async finish(usage, deps) {
      if (closed) return;
      closed = true;
      await recordAiCall(
        { ...meta, status: "OK", usage, latencyMs: now() - startedAt },
        deps,
      );
    },
    async fail(err, deps) {
      if (closed) return;
      closed = true;
      const { status, reason } = classifyCallFailure(err);
      await recordAiCall(
        {
          ...meta,
          status,
          errorReason: reason,
          latencyMs: now() - startedAt,
        },
        deps,
      );
    },
  };
}

/**
 * Runs `fn`, records the call, and returns or rethrows what `fn` did.
 *
 * @param meta - Who and what the call is.
 * @param fn - The call. Its result's `usage` field is read for tokens.
 * @param extractUsage - Replaces the default Responses API usage reader.
 * @returns Whatever `fn` returned.
 */
export async function withAiCall<T>(
  meta: AiCallMeta,
  fn: () => Promise<T>,
  extractUsage: (result: T) => AiCallUsage = usageFromResponse,
): Promise<T> {
  const call = startAiCall(meta);
  let result: T;
  try {
    result = await fn();
  } catch (err) {
    await call.fail(err);
    throw err;
  }
  await call.finish(extractUsage(result));
  return result;
}

/** What a refusal records. */
export type AiRefusalLogInput = {
  readonly workspaceId: string | null;
  readonly userId: string | null;
  readonly feature: AiFeature;
  /** The reason the resolver gave. */
  readonly reason: string;
  /** The selection that would have run, when there was one. */
  readonly attempted?: {
    readonly providerId: string;
    readonly modelId: string;
    readonly source: "byok" | "free";
  };
};

/**
 * Records a resolver refusal as a `REFUSED` row, with provider and model set to
 * the selection that would have run, or `"none"`.
 */
export async function recordAiRefusal(
  input: AiRefusalLogInput,
  deps: CallLogDeps = {},
): Promise<void> {
  await recordAiCall(
    {
      workspaceId: input.workspaceId,
      userId: input.userId,
      feature: input.feature,
      providerId: input.attempted?.providerId ?? "none",
      modelId: input.attempted?.modelId ?? "none",
      source: input.attempted?.source ?? "free",
      status: "REFUSED",
      errorReason: input.reason,
      latencyMs: 0,
    },
    deps,
  );
}
