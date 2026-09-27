/**
 * @module api/__tests__/unit/aiQuota
 * @description Quota limit parsing — the only piece of {@link quota} that is
 * pure enough to exercise without a database. The race-safe claim lives in
 * `persistence/aiQuota.test.ts`, which runs against the real test Postgres.
 *
 * The reason this file is small: a quota counter is one column on `User`
 * (decision 5, Illume's simplification). The only logic in `lib/ai/quota.ts`
 * that does not need a database is "how is `AI_FREE_DOC_LIMIT` parsed" — and
 * that parsing is the gate to the rest of the module.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readQuotaLimit } from "../../lib/ai/quota";

const SAVED = process.env.AI_FREE_DOC_LIMIT;

beforeEach(() => {
  delete process.env.AI_FREE_DOC_LIMIT;
});

afterEach(() => {
  if (SAVED === undefined) delete process.env.AI_FREE_DOC_LIMIT;
  else process.env.AI_FREE_DOC_LIMIT = SAVED;
});

describe("readQuotaLimit — env parsing", () => {
  it("returns the documented default of 5 when unset", () => {
    // The plan default is 5, not 0 — the product decision recorded by Phase 0
    // is that DeepSeek's per-document cost is small enough that 5 is fine as
    // a trial, not a cost ceiling. A "no trials" deployment sets the env to
    // 0; an empty env must NOT be the same.
    expect(readQuotaLimit()).toBe(5);
  });

  it("returns the configured value when set to a positive integer", () => {
    process.env.AI_FREE_DOC_LIMIT = "12";
    expect(readQuotaLimit()).toBe(12);
  });

  it("treats 0 as a deliberate disable, not as missing", () => {
    // A deployment that wants to ship without a free tier sets the var to 0
    // — this must not silently fall back to the default and quietly enable
    // the trial again.
    process.env.AI_FREE_DOC_LIMIT = "0";
    expect(readQuotaLimit()).toBe(0);
  });

  it("falls back to the default on a non-numeric value", () => {
    // `z.coerce.number()` in env.ts would already reject this at boot, but
    // the quota module reads the env directly at call time so a stale or
    // manually-set value cannot crash the request path.
    process.env.AI_FREE_DOC_LIMIT = "five";
    expect(readQuotaLimit()).toBe(5);
  });

  it("falls back to the default on a negative value", () => {
    // Negative would never make sense; treat as a misconfiguration rather
    // than honouring it.
    process.env.AI_FREE_DOC_LIMIT = "-1";
    expect(readQuotaLimit()).toBe(5);
  });

  it("parses a float by truncation — the value 4.9 becomes 4", () => {
    // `parseInt("4.9", 10)` returns 4 (truncation, not rounding). The
    // schema coerces to int at boot, but this module reads the env directly
    // at call time, so a stale value cannot crash the request path. A
    // separate question is whether honouring it is correct; the answer is
    // "yes — the truncation is deterministic and the schema has already
    // produced a clean integer in any well-formed deployment".
    process.env.AI_FREE_DOC_LIMIT = "4.9";
    expect(readQuotaLimit()).toBe(4);
  });

  it("treats an empty string as unset", () => {
    process.env.AI_FREE_DOC_LIMIT = "";
    expect(readQuotaLimit()).toBe(5);
  });
});
