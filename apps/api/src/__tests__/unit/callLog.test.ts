/**
 * @module api/__tests__/unit/callLog
 * @description The call log's write path with injected collaborators: usage
 * mapping, cost estimation, the failure taxonomy, and the guarantee that
 * logging never throws and never stores provider text.
 */
import { describe, expect, it, vi } from "vitest";
import {
  AiCallError,
  LAST_USED_GATE_SECONDS,
  classifyCallFailure,
  estimateCallCost,
  recordAiCall,
  recordAiRefusal,
  startAiCall,
  usageFromResponse,
  withAiCall,
  type AiCallMeta,
  type CallLogDeps,
} from "../../lib/ai/callLog";

const META: AiCallMeta = {
  workspaceId: "ws-1",
  userId: "user-1",
  feature: "chat",
  providerId: "openai",
  modelId: "gpt-5-nano",
  source: "byok",
  pricing: { inputPerMTok: 1, outputPerMTok: 2 },
  credentialId: "cred-1",
};

function fakeDeps(
  options: { setResult?: string | null; createError?: unknown } = {},
) {
  const create = vi.fn(async (_args: unknown) => {
    if (options.createError) throw options.createError;
    return {};
  });
  const updateMany = vi.fn(async (_args: unknown) => ({ count: 1 }));
  const set = vi.fn(async () =>
    options.setResult === undefined ? "OK" : options.setResult,
  );
  const deps = {
    db: { aiCall: { create }, workspaceAiCredential: { updateMany } },
    redis: { set },
  } as unknown as CallLogDeps;
  return { deps, create, updateMany, set };
}

const rowOf = (create: ReturnType<typeof fakeDeps>["create"]) =>
  (create.mock.calls[0]![0] as { data: Record<string, unknown> }).data;

describe("recordAiCall for a meeting", () => {
  it("stores the meeting the call was made for", async () => {
    const { deps, create } = fakeDeps();

    await recordAiCall(
      { ...META, meetingId: "meeting-1", status: "OK", latencyMs: 5 },
      deps,
    );

    expect(rowOf(create).meetingId).toBe("meeting-1");
  });

  it("stores no meeting for an ordinary call", async () => {
    const { deps, create } = fakeDeps();

    await recordAiCall({ ...META, status: "OK", latencyMs: 5 }, deps);

    expect(rowOf(create).meetingId).toBeNull();
  });
});

describe("estimateCallCost", () => {
  it("prices tokens from the model's list prices", () => {
    expect(
      estimateCallCost(META.pricing, {
        inputTokens: 1_000_000,
        outputTokens: 500_000,
      }),
    ).toBe(2);
  });

  it("prices audio by the minute and speech by the character", () => {
    expect(
      estimateCallCost({ perAudioMinute: 0.006 } as never, { audioSeconds: 30 }),
    ).toBe(0.003);
    expect(
      estimateCallCost({ perMChars: 15 } as never, { characters: 100_000 }),
    ).toBe(1.5);
  });

  it("is null without a price, and null when nothing was used", () => {
    expect(estimateCallCost(undefined, { inputTokens: 10 })).toBeNull();
    expect(estimateCallCost(META.pricing, {})).toBeNull();
  });
});

describe("usageFromResponse", () => {
  it("reads input, output and reasoning tokens", () => {
    expect(
      usageFromResponse({
        usage: {
          input_tokens: 12,
          output_tokens: 30,
          output_tokens_details: { reasoning_tokens: 7 },
        },
      }),
    ).toEqual({ inputTokens: 12, outputTokens: 30, reasoningTokens: 7 });
  });

  it("leaves absent fields undefined and tolerates junk", () => {
    expect(usageFromResponse({ usage: { input_tokens: "x" } })).toEqual({
      inputTokens: undefined,
      outputTokens: undefined,
      reasoningTokens: undefined,
    });
    expect(usageFromResponse(null)).toEqual({});
    expect(usageFromResponse({ usage: 5 })).toEqual({});
  });
});

describe("classifyCallFailure", () => {
  it("maps aborts to CANCELLED", () => {
    const abort = Object.assign(new Error("x"), { name: "AbortError" });
    expect(classifyCallFailure(abort)).toEqual({
      status: "CANCELLED",
      reason: "cancelled",
    });
    const sdk = Object.assign(new Error("x"), { name: "APIUserAbortError" });
    expect(classifyCallFailure(sdk).status).toBe("CANCELLED");
  });

  it("keeps the reason an AiCallError carries", () => {
    expect(classifyCallFailure(new AiCallError("parse-failed"))).toEqual({
      status: "ERROR",
      reason: "parse-failed",
    });
  });

  it("maps transport timeouts", () => {
    const timeout = Object.assign(new Error("x"), {
      name: "APIConnectionTimeoutError",
    });
    expect(classifyCallFailure(timeout).reason).toBe("timeout");
  });

  it("maps a rejected key and everything else", () => {
    expect(classifyCallFailure({ status: 401 }).reason).toBe("invalid-key");
    expect(classifyCallFailure(new Error("boom")).reason).toBe(
      "provider-error",
    );
    expect(classifyCallFailure(undefined).reason).toBe("provider-error");
  });
});

describe("recordAiCall", () => {
  it("writes one row with the usage, estimated cost and rounded latency", async () => {
    const { deps, create } = fakeDeps();
    await recordAiCall(
      {
        ...META,
        status: "OK",
        usage: {
          inputTokens: 1_000_000,
          outputTokens: 500_000,
          reasoningTokens: 3,
        },
        latencyMs: 12.6,
      },
      deps,
    );
    expect(create).toHaveBeenCalledTimes(1);
    expect(rowOf(create)).toMatchObject({
      workspaceId: "ws-1",
      userId: "user-1",
      feature: "CHAT",
      providerId: "openai",
      modelId: "gpt-5-nano",
      source: "BYOK",
      status: "OK",
      errorReason: null,
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      reasoningTokens: 3,
      audioSeconds: null,
      characters: null,
      latencyMs: 13,
      costUsd: 2,
    });
  });

  it("stores the free source, a null cost for a failure, and never a negative latency", async () => {
    const { deps, create } = fakeDeps();
    await recordAiCall(
      {
        ...META,
        source: "free",
        status: "ERROR",
        errorReason: "timeout",
        latencyMs: -5,
      },
      deps,
    );
    expect(rowOf(create)).toMatchObject({
      source: "FREE",
      status: "ERROR",
      errorReason: "timeout",
      costUsd: null,
      latencyMs: 0,
    });
  });

  it("lets a provider-reported cost override the estimate", async () => {
    const { deps, create } = fakeDeps();
    await recordAiCall(
      {
        ...META,
        status: "OK",
        usage: { inputTokens: 10 },
        latencyMs: 1,
        costUsd: 0.5,
      },
      deps,
    );
    expect(rowOf(create).costUsd).toBe(0.5);
  });

  it("does not throw when the database fails, and logs only the error name and code", async () => {
    const secretText =
      "Unique constraint failed on sk-test-fake-key-DISTINCT12345678";
    const { deps } = fakeDeps({
      createError: Object.assign(new Error(secretText), {
        name: "PrismaError",
        code: "P2002",
      }),
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      recordAiCall({ ...META, status: "OK", latencyMs: 1 }, deps),
    ).resolves.toBeUndefined();
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).toContain("PrismaError/P2002");
    expect(logged).not.toContain("DISTINCT12345678");
    spy.mockRestore();
  });

  it("stamps the credential at most once per gate window", async () => {
    const won = fakeDeps({ setResult: "OK" });
    await recordAiCall({ ...META, status: "OK", latencyMs: 1 }, won.deps);
    expect(won.set).toHaveBeenCalledWith(
      "ai:lastused:cred-1",
      "1",
      "EX",
      LAST_USED_GATE_SECONDS,
      "NX",
    );
    expect(won.updateMany).toHaveBeenCalledTimes(1);

    const lost = fakeDeps({ setResult: null });
    await recordAiCall({ ...META, status: "OK", latencyMs: 1 }, lost.deps);
    expect(lost.updateMany).not.toHaveBeenCalled();
  });

  it("does not stamp the credential for a failed call or when there is none", async () => {
    const failed = fakeDeps();
    await recordAiCall(
      { ...META, status: "ERROR", latencyMs: 1 },
      failed.deps,
    );
    expect(failed.set).not.toHaveBeenCalled();

    const none = fakeDeps();
    await recordAiCall(
      { ...META, credentialId: undefined, status: "OK", latencyMs: 1 },
      none.deps,
    );
    expect(none.set).not.toHaveBeenCalled();
  });

  it("survives a Redis failure while stamping", async () => {
    const { deps, create } = fakeDeps();
    (deps.redis as { set: unknown }).set = vi.fn(async () => {
      throw new Error("redis down");
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      recordAiCall({ ...META, status: "OK", latencyMs: 1 }, deps),
    ).resolves.toBeUndefined();
    expect(create).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe("startAiCall", () => {
  it("measures latency with the injected clock and records once", async () => {
    const { deps, create } = fakeDeps();
    let t = 1000;
    const call = startAiCall(META, () => t);
    t = 1250;
    await call.finish({ inputTokens: 5 }, deps);
    await call.fail(new Error("late"), deps);
    await call.finish({ inputTokens: 6 }, deps);
    expect(create).toHaveBeenCalledTimes(1);
    expect(rowOf(create)).toMatchObject({
      status: "OK",
      latencyMs: 250,
      inputTokens: 5,
    });
  });

  it("records an abort as CANCELLED", async () => {
    const { deps, create } = fakeDeps();
    const call = startAiCall(META);
    await call.fail(
      Object.assign(new Error("x"), { name: "AbortError" }),
      deps,
    );
    expect(rowOf(create)).toMatchObject({
      status: "CANCELLED",
      errorReason: "cancelled",
    });
  });

  it("never stores the provider's error text", async () => {
    const { deps, create } = fakeDeps();
    const call = startAiCall(META);
    await call.fail(
      new Error("Incorrect API key provided: sk-test-fake-key-DISTINCT12345678"),
      deps,
    );
    expect(JSON.stringify(create.mock.calls)).not.toContain(
      "DISTINCT12345678",
    );
    expect(rowOf(create).errorReason).toBe("provider-error");
  });
});

describe("withAiCall", () => {
  it("returns the result", async () => {
    const result = { usage: { input_tokens: 4, output_tokens: 6 } };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      withAiCall(
        { ...META, workspaceId: null, credentialId: undefined },
        async () => result,
      ),
    ).resolves.toBe(result);
    spy.mockRestore();
  });

  it("rethrows what the call threw", async () => {
    const boom = new Error("boom");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      withAiCall(
        { ...META, workspaceId: null, credentialId: undefined },
        async () => {
          throw boom;
        },
      ),
    ).rejects.toBe(boom);
    spy.mockRestore();
  });
});

describe("recordAiRefusal", () => {
  it("writes a REFUSED row naming the attempted selection", async () => {
    const { deps, create } = fakeDeps();
    await recordAiRefusal(
      {
        workspaceId: "ws-1",
        userId: "user-1",
        feature: "chat",
        reason: "spend-cap-reached",
        attempted: {
          providerId: "openai",
          modelId: "gpt-5-nano",
          source: "byok",
        },
      },
      deps,
    );
    expect(rowOf(create)).toMatchObject({
      status: "REFUSED",
      errorReason: "spend-cap-reached",
      providerId: "openai",
      modelId: "gpt-5-nano",
      source: "BYOK",
      costUsd: null,
      latencyMs: 0,
    });
  });

  it("falls back to none/FREE without an attempted selection", async () => {
    const { deps, create } = fakeDeps();
    await recordAiRefusal(
      {
        workspaceId: "ws-1",
        userId: null,
        feature: "chat",
        reason: "no-operator-key",
      },
      deps,
    );
    expect(rowOf(create)).toMatchObject({
      providerId: "none",
      modelId: "none",
      source: "FREE",
    });
  });
});
