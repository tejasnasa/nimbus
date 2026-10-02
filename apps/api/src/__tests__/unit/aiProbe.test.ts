/**
 * @module api/__tests__/unit/aiProbe
 * @description The save-time key probe: the request shape it sends and the
 * status-to-message mapping that decides whether a credential may be stored.
 *
 * The OpenAI SDK is mocked here — unlike the client-factory tests, which
 * construct it and deliberately never call anything — because the probe's whole
 * job is a single request plus the classification of how that request fails.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AI_PROVIDERS, type AiModelSpec } from "@nimbus/types";
import { probeApiKey } from "../../lib/ai/probe";

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    responses = { create: createMock };
  },
}));

const provider = AI_PROVIDERS.deepseek;
const model: AiModelSpec = {
  id: "deepseek-flash",
  label: "DeepSeek Flash",
  capabilities: ["reasoning", "streaming"],
  effortLevels: ["low"],
};

beforeEach(() => {
  createMock.mockReset();
});

describe("probeApiKey", () => {
  it("accepts the key when the provider answers, and sends a minimal request", async () => {
    createMock.mockResolvedValue({ id: "resp_1" });

    const result = await probeApiKey(provider, "sk-candidate", model, "low");

    expect(result).toEqual({ ok: true });
    expect(createMock).toHaveBeenCalledTimes(1);
    const request = createMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(request.model).toBe("deepseek-flash");
    expect(request.input).toBe("hi");
    expect(request.max_output_tokens).toBe(16);
  });

  it("falls back to the lowest effort when none is supplied", async () => {
    createMock.mockResolvedValue({ id: "resp_2" });

    await expect(probeApiKey(provider, "sk-candidate", model)).resolves.toEqual(
      { ok: true },
    );
  });

  it("maps 401 and 403 to a curated incorrect-key refusal", async () => {
    for (const status of [401, 403]) {
      createMock.mockRejectedValue({ status });

      await expect(probeApiKey(provider, "sk-bad", model)).resolves.toEqual({
        ok: false,
        reason: "incorrect-key",
        message: "Incorrect API key.",
      });
    }
  });

  it("maps 404 to a model-not-found refusal that names the provider", async () => {
    createMock.mockRejectedValue({ status: 404 });

    const result = await probeApiKey(provider, "sk-bad", model);

    expect(result).toEqual({
      ok: false,
      reason: "model-not-found",
      message: `That model isn't available on ${provider.label}.`,
    });
  });

  it("treats a transport failure carrying no status as unreachable", async () => {
    createMock.mockRejectedValue(new Error("socket hang up"));

    const result = await probeApiKey(provider, "sk-bad", model);

    expect(result).toEqual({
      ok: false,
      reason: "unreachable",
      message: `Could not reach ${provider.label}.`,
    });
  });

  it("treats a thrown non-object as unreachable rather than crashing", async () => {
    createMock.mockRejectedValue("boom");

    await expect(probeApiKey(provider, "sk-bad", model)).resolves.toMatchObject(
      { ok: false, reason: "unreachable" },
    );
  });

  it("ignores a status that is not a number", async () => {
    createMock.mockRejectedValue({ status: "401" });

    await expect(probeApiKey(provider, "sk-bad", model)).resolves.toMatchObject(
      { ok: false, reason: "unreachable" },
    );
  });

  it("maps every other status to an unknown-error refusal", async () => {
    createMock.mockRejectedValue({ status: 500 });

    const result = await probeApiKey(provider, "sk-bad", model);

    expect(result).toMatchObject({ ok: false, reason: "unknown-error" });
    if (result.ok) throw new Error("expected a refusal");
    expect(result.message).toContain(provider.label);
    // The key must never be echoed back to the user in a failure message.
    expect(result.message).not.toContain("sk-bad");
  });
});
