/**
 * @module api/__tests__/unit/verifyProvider
 * @description The provider verification script with both probes faked: input
 * validation, exit codes, the registry comparison, and that the key is never
 * printed.
 */
import { describe, expect, it, vi } from "vitest";
import {
  verifyProvider,
  type VerifyProviderDeps,
} from "../../scripts/verifyProvider";

const KEY = "sk-or-test-DISTINCT-key-123456";

/** Fake deps that record every printed line. */
function makeDeps(
  overrides: Partial<Pick<VerifyProviderDeps, "probeApiKey" | "probeModel">> = {},
) {
  const lines: string[] = [];
  const deps: VerifyProviderDeps = {
    probeApiKey: vi.fn(async () => ({ ok: true as const })) as never,
    probeModel: vi.fn(async () => ({
      ok: true as const,
      capabilities: ["tools", "streaming", "jsonMode"],
      servesFeatures: ["chat", "markdown", "canvas"],
    })) as never,
    log: (line) => lines.push(line),
    error: (line) => lines.push(line),
    ...overrides,
  };
  return { deps, lines };
}

describe("verifyProvider", () => {
  it("rejects an unknown provider with exit code 2", async () => {
    const { deps, lines } = makeDeps();
    expect(await verifyProvider({ PROVIDER_ID: "nope", PROVIDER_API_KEY: KEY }, deps)).toBe(2);
    expect(lines.join("\n")).toContain("PROVIDER_ID must be one of");
  });

  it("requires a key", async () => {
    const { deps, lines } = makeDeps();
    expect(await verifyProvider({ PROVIDER_ID: "openai" }, deps)).toBe(2);
    expect(lines.join("\n")).toContain("PROVIDER_API_KEY is required");
  });

  it("returns 0 and reports a registry match when both probes pass", async () => {
    const { deps, lines } = makeDeps({
      probeModel: vi.fn(async () => ({
        ok: true as const,
        capabilities: ["tools", "streaming", "jsonMode", "reasoning", "reasoningSummary", "vision"],
        servesFeatures: ["chat", "markdown", "canvas"],
      })) as never,
    });
    const code = await verifyProvider(
      { PROVIDER_ID: "openai", PROVIDER_API_KEY: KEY, MODEL_ID: "gpt-5-nano" },
      deps,
    );
    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("registry matches the measurement");
  });

  it("reports differences between the registry and the measurement", async () => {
    const { deps, lines } = makeDeps();
    await verifyProvider(
      { PROVIDER_ID: "openai", PROVIDER_API_KEY: KEY, MODEL_ID: "gpt-5-nano" },
      deps,
    );
    expect(lines.join("\n")).toMatch(/registry differs\. claimed but not measured: .*reasoning/);
  });

  it("notes an id that is not in the registry, and falls back to a registry model for the key probe", async () => {
    const { deps, lines } = makeDeps();
    const code = await verifyProvider(
      { PROVIDER_ID: "openai", PROVIDER_API_KEY: KEY, MODEL_ID: "custom-model" },
      deps,
    );
    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("not in the registry");
    const probedModel = (deps.probeApiKey as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][2] as { id: string };
    expect(probedModel.id).toBe("gpt-5-nano");
  });

  it("returns 1 when the capability probe fails", async () => {
    const { deps, lines } = makeDeps({
      probeModel: vi.fn(async () => ({
        ok: false as const,
        reason: "model-not-found",
        message: "That model isn't available.",
      })) as never,
    });
    const code = await verifyProvider({ PROVIDER_ID: "openai", PROVIDER_API_KEY: KEY }, deps);
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain("Capability probe: FAILED, model-not-found");
  });

  it("returns 1 when the key probe fails even if the capability probe passes", async () => {
    const { deps, lines } = makeDeps({
      probeApiKey: vi.fn(async () => ({
        ok: false as const,
        reason: "incorrect-key",
        message: "Incorrect API key.",
      })) as never,
    });
    const code = await verifyProvider({ PROVIDER_ID: "openai", PROVIDER_API_KEY: KEY }, deps);
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain("FAILED, incorrect-key");
  });

  it("never prints the key", async () => {
    const { deps, lines } = makeDeps();
    await verifyProvider({ PROVIDER_ID: "openrouter", PROVIDER_API_KEY: KEY }, deps);
    expect(lines.join("\n")).not.toContain(KEY);
    expect(lines.join("\n")).not.toContain("DISTINCT");
  });
});
