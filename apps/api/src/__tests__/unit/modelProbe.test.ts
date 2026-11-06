/**
 * @module api/__tests__/unit/modelProbe
 * @description The custom-model capability probe, against a scripted fake
 * provider. No network, no key: the fake decides, per request shape, whether the
 * provider would accept it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { AI_PROVIDERS } from "@nimbus/types";
import { probeModel, type ProbeClient } from "../../lib/ai/modelProbe";

const provider = AI_PROVIDERS.openrouter;
const SECRET = "sk-or-super-secret-DISTINCT-0987654321";

type Params = Record<string, unknown>;
type Behaviour = {
  /** Fails the very first plain call with this status (or a transport error). */
  basicFails?: number | "network";
  tools?: boolean;
  json?: boolean | "invalid";
  streaming?: boolean;
  reasoning?: boolean;
  summary?: boolean;
  vision?: boolean;
};

const httpError = (status: number) =>
  Object.assign(new Error(`HTTP ${status} echoing ${SECRET}`), { status });

/** A provider that accepts exactly the request shapes `behaviour` allows. */
function fakeProvider(behaviour: Behaviour = {}) {
  const calls: Params[] = [];
  const client: ProbeClient = {
    responses: {
      async create(params: Params) {
        calls.push(params);
        const reasoning = params.reasoning as { summary?: string } | undefined;
        const text = params.text as { format?: { type?: string } } | undefined;

        if (params.stream) {
          if (!behaviour.streaming) throw httpError(400);
          return (async function* () {
            yield { type: "response.created" };
            yield { type: "response.completed" };
          })();
        }
        if (params.tools) {
          if (!behaviour.tools) throw httpError(400);
          return { output: [{ type: "function_call", name: "ping" }] };
        }
        if (text?.format?.type === "json_object") {
          if (!behaviour.json) throw httpError(400);
          return {
            output_text: behaviour.json === "invalid" ? "not json" : '{"ok":true}',
            output: [],
          };
        }
        if (reasoning) {
          if (!behaviour.reasoning) throw httpError(400);
          if (reasoning.summary && !behaviour.summary) throw httpError(400);
          return { output: [], output_text: "hi" };
        }
        if (Array.isArray(params.input)) {
          if (!behaviour.vision) throw httpError(400);
          return { output: [], output_text: "hi" };
        }
        if (behaviour.basicFails === "network") {
          throw new Error("connection reset");
        }
        if (behaviour.basicFails) throw httpError(behaviour.basicFails);
        return { output: [], output_text: "hi" };
      },
    },
  };
  return { client, calls };
}

const run = (behaviour?: Behaviour) => {
  const fake = fakeProvider(behaviour);
  return {
    ...fake,
    result: probeModel(provider, SECRET, "vendor/model", { client: fake.client }),
  };
};

afterEach(() => vi.restoreAllMocks());

describe("probeModel: capability detection", () => {
  it("detects every capability a fully capable model has", async () => {
    const measured = await run({
      tools: true,
      json: true,
      streaming: true,
      reasoning: true,
      summary: true,
      vision: true,
    }).result;

    expect(measured.ok).toBe(true);
    if (!measured.ok) return;
    expect([...measured.capabilities].sort()).toEqual(
      [
        "jsonMode",
        "reasoning",
        "reasoningSummary",
        "streaming",
        "tools",
        "vision",
      ].sort(),
    );
    expect(measured.servesFeatures).toEqual(["chat", "markdown", "canvas", "vision", "meeting"]);
  });

  it("reports nothing extra for a model that only answers the basic call", async () => {
    const measured = await run().result;

    expect(measured).toEqual({ ok: true, capabilities: [], servesFeatures: [] });
  });

  it.each([
    ["tools", { tools: true }, ["tools"], ["chat"]],
    ["json mode", { json: true }, ["jsonMode"], []],
    ["streaming", { streaming: true }, ["streaming"], ["markdown"]],
    ["vision", { vision: true }, ["vision"], []],
  ] as const)(
    "detects %s on its own",
    async (_name, behaviour, capabilities, serves) => {
      const measured = await run(behaviour).result;

      expect(measured).toEqual({
        ok: true,
        capabilities: [...capabilities],
        servesFeatures: [...serves],
      });
    },
  );

  it("does not count json mode when the output does not parse", async () => {
    const measured = await run({ json: "invalid" }).result;

    expect(measured).toMatchObject({ ok: true, capabilities: [] });
  });

  it("accepts reasoning without summary, and asks about summary only after reasoning", async () => {
    const withReasoning = run({ reasoning: true, summary: false });
    const measured = await withReasoning.result;

    expect(measured).toMatchObject({ ok: true, capabilities: ["reasoning"] });
    const summaryAsks = withReasoning.calls.filter(
      (c) => (c.reasoning as { summary?: string } | undefined)?.summary,
    );
    expect(summaryAsks).toHaveLength(1);

    const without = run({ reasoning: false });
    await without.result;
    expect(
      without.calls.some(
        (c) => (c.reasoning as { summary?: string } | undefined)?.summary,
      ),
    ).toBe(false);
  });

  it("serves canvas for a model with streaming and json mode", async () => {
    const measured = await run({ streaming: true, json: true }).result;

    expect(measured).toMatchObject({
      ok: true,
      servesFeatures: ["markdown", "canvas"],
    });
  });
});

describe("probeModel: request shape and limits", () => {
  it("caps every request's output tokens and names the model", async () => {
    const { result, calls } = run({ tools: true, json: true, streaming: true });
    await result;

    expect(calls.length).toBeGreaterThanOrEqual(6);
    for (const call of calls) {
      expect(call.model).toBe("vendor/model");
      // Only the tool and JSON probes need room for a reasoning model to finish.
      const needsAnswer = Boolean(call.tools) || Boolean(call.text);
      expect(call.max_output_tokens).toBeLessThanOrEqual(needsAnswer ? 1024 : 64);
    }
  });

  it("gives the tool and JSON probes room to finish after reasoning", async () => {
    const { result, calls } = run({ tools: true, json: true });
    await result;

    expect(calls.find((c) => c.tools)?.max_output_tokens).toBe(1024);
    expect(calls.find((c) => c.text)?.max_output_tokens).toBe(1024);
  });

  it("asks for a tool call with tool_choice auto, which every provider accepts", async () => {
    const { result, calls } = run({ tools: true });
    await result;

    expect(calls.find((c) => c.tools)?.tool_choice).toBe("auto");
  });

  it("sends a data-URL image for the vision probe", async () => {
    const { result, calls } = run({ vision: true });
    await result;

    const visionCall = calls.find((c) => Array.isArray(c.input));
    expect(JSON.stringify(visionCall?.input)).toContain("data:image/png;base64,");
  });
});

describe("probeModel: basic failure short-circuits", () => {
  it.each([
    [401, "incorrect-key"],
    [403, "incorrect-key"],
    [404, "model-not-found"],
    [429, "unknown-error"],
    ["network", "unreachable"],
  ] as const)(
    "status %s becomes %s and nothing else runs",
    async (status, reason) => {
      const { result, calls } = run({
        basicFails: status,
        tools: true,
        json: true,
        streaming: true,
      });

      const measured = await result;

      expect(measured).toMatchObject({ ok: false, reason });
      expect(calls).toHaveLength(1);
    },
  );

  it("uses the curated message with the provider label", async () => {
    const measured = await run({ basicFails: 404 }).result;

    expect(measured).toMatchObject({
      ok: false,
      message: expect.stringContaining("OpenRouter"),
    });
  });
});

describe("probeModel: the key never leaks", () => {
  it("is absent from a refusal, a success, and every log line", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const refused = await run({ basicFails: 401 }).result;
    const accepted = await run({ tools: true, reasoning: true }).result;

    expect(JSON.stringify(refused)).not.toContain(SECRET);
    expect(JSON.stringify(accepted)).not.toContain(SECRET);
    for (const spy of [log, warn, error]) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(SECRET);
    }
  });

  it("does not echo provider error text, even when it contains the key", async () => {
    const measured = await run({ basicFails: 400 }).result;

    expect(measured.ok).toBe(false);
    if (measured.ok) return;
    expect(measured.message).not.toMatch(/sk-|echoing/i);
  });
});
