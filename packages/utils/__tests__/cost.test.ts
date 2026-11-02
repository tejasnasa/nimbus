/**
 * @module utils/__tests__/cost
 * @description `estimateCostUsd`: token, audio-minute and character pricing, the
 * `null` answer for a missing price, and rounding.
 */
import { describe, expect, it } from "vitest";
import { estimateCostUsd } from "../src/ai/cost";

const checkedAt = "2026-11-02";

describe("estimateCostUsd", () => {
  it("prices input and output tokens per million", () => {
    const spec = { pricing: { inputPerMTok: 0.25, outputPerMTok: 2, checkedAt } };

    expect(
      estimateCostUsd(spec, { inputTokens: 1_000_000, outputTokens: 500_000 }),
    ).toBe(1.25);
  });

  it("prices audio by the minute", () => {
    const spec = { pricing: { perAudioMinute: 0.006, checkedAt } };

    expect(estimateCostUsd(spec, { audioMinutes: 10 })).toBe(0.06);
  });

  it("prices speech by the million characters", () => {
    const spec = { pricing: { perMChars: 15, checkedAt } };

    expect(estimateCostUsd(spec, { characters: 2_000 })).toBe(0.03);
  });

  it("sums every dimension the call used", () => {
    const spec = {
      pricing: { inputPerMTok: 1, outputPerMTok: 2, perAudioMinute: 0.5, checkedAt },
    };

    expect(
      estimateCostUsd(spec, {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        audioMinutes: 2,
      }),
    ).toBe(4);
  });

  it("returns null when a price the usage needs is missing", () => {
    const spec = { pricing: { inputPerMTok: 1, checkedAt } };

    expect(
      estimateCostUsd(spec, { inputTokens: 1000, outputTokens: 1000 }),
    ).toBeNull();
  });

  it("ignores a missing price for a dimension with no usage", () => {
    const spec = { pricing: { inputPerMTok: 1, checkedAt } };

    expect(estimateCostUsd(spec, { inputTokens: 1_000_000, outputTokens: 0 })).toBe(1);
  });

  it("returns null when the model has no pricing at all", () => {
    expect(estimateCostUsd({}, { inputTokens: 10 })).toBeNull();
    expect(estimateCostUsd(undefined, { inputTokens: 10 })).toBeNull();
  });

  it("returns null when there is no billable usage", () => {
    const spec = { pricing: { inputPerMTok: 1, outputPerMTok: 1, checkedAt } };

    expect(estimateCostUsd(spec, {})).toBeNull();
    expect(estimateCostUsd(spec, { inputTokens: 0 })).toBeNull();
  });

  it("rounds to six decimal places", () => {
    const spec = { pricing: { inputPerMTok: 0.05, checkedAt } };

    // 13 tokens at $0.05 per million is 6.5e-7, which rounds up to one micro-dollar;
    // 7 tokens is 3.5e-7, which rounds down to zero.
    expect(estimateCostUsd(spec, { inputTokens: 13 })).toBe(0.000001);
    expect(estimateCostUsd(spec, { inputTokens: 7 })).toBe(0);
    expect(estimateCostUsd(spec, { inputTokens: 1_234_567 })).toBe(0.061728);
  });
});
