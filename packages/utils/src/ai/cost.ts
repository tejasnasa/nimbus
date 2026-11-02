/**
 * @module utils/ai/cost
 * @description Pure cost estimation from a model's list prices.
 *
 * Prices come from `AiModelSpec.pricing` (hand-maintained, stamped with the date
 * they were read) or, for OpenRouter catalogue models, from the catalogue's own
 * per-token prices mapped into the same shape. Estimation answers `null` rather
 * than a number whenever a price it needs is missing, because a wrong cost shown
 * as fact is worse than none.
 *
 * @important No DB, env, SDK or logger here, and nothing from `apps/api`. The
 *            result is an estimate from list prices: it ignores cached-input
 *            discounts, tiered or off-peak rates and provider-side rounding.
 */
import type { AiModelPricing } from "@nimbus/types";

/** Token counts for a text call. */
export type TokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
};

/** Everything a call can be billed on. Supply only the fields that apply. */
export type CostUsage = TokenUsage & {
  /** Minutes of audio transcribed. */
  audioMinutes?: number;
  /** Characters of text synthesised to speech. */
  characters?: number;
};

/** Decimal places the estimate is rounded to. */
const DECIMALS = 6;

/**
 * Estimates the USD cost of one call.
 *
 * A dimension contributes only when its usage is present and greater than
 * zero; once it does, its price must exist or the whole estimate is `null`. A
 * call with no billable usage at all is also `null`, since there is nothing to
 * estimate from.
 *
 * @param spec - Anything carrying optional `pricing`: a registry model, or an
 *               object built from catalogue prices.
 * @param usage - What the call consumed.
 * @returns USD rounded to 6 decimal places, or `null` when a needed price or
 *          all usage is missing.
 */
export function estimateCostUsd(
  spec: { pricing?: AiModelPricing } | undefined,
  usage: CostUsage,
): number | null {
  const pricing = spec?.pricing;
  if (!pricing) return null;

  const lines: Array<[units: number | undefined, perUnit: number | undefined, divisor: number]> = [
    [usage.inputTokens, pricing.inputPerMTok, 1_000_000],
    [usage.outputTokens, pricing.outputPerMTok, 1_000_000],
    [usage.audioMinutes, pricing.perAudioMinute, 1],
    [usage.characters, pricing.perMChars, 1_000_000],
  ];

  let total = 0;
  let billed = false;
  for (const [units, perUnit, divisor] of lines) {
    if (units === undefined || units <= 0) continue;
    if (perUnit === undefined) return null;
    total += (units / divisor) * perUnit;
    billed = true;
  }

  if (!billed) return null;
  const factor = 10 ** DECIMALS;
  return Math.round(total * factor) / factor;
}
