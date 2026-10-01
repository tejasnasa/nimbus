/**
 * @module api/__tests__/unit/markdownGeneration
 * @description The streaming Markdown generator. The SDK client is mocked with
 * a synthetic event stream, so what's pinned is the stream handling: which
 * delta types accumulate into the document, which go to the "thinking"
 * channel, and what is sent upstream.
 *
 * The client seam is the per-call `AiClientHandle`: production goes through
 * `createAiClient`, tests inject a fake whose SDK is the mocked `createMock`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

import { AI_PROVIDERS, modelById } from "@nimbus/types";
import { generateMarkdownDocument } from "../../lib/markdownGeneration";
import type { AiClientHandle } from "../../lib/ai/clientFactory";

/** A test-only handle whose SDK client is the mocked `createMock`. */
const makeTestHandle = (
  modelId = "deepseek-flash",
  provider = AI_PROVIDERS.deepseek,
): AiClientHandle => {
  const model = modelById(provider, modelId);
  if (!model) throw new Error(`unknown model ${modelId}`);
  return {
    providerId: provider.id,
    modelId: model.id,
    source: "free",
    supportsReasoning: model.capabilities.includes("reasoning"),
    client: {
      responses: { create: createMock },
    } as unknown as AiClientHandle["client"],
  };
};

/** Wraps events in the async iterable the SDK returns for a streamed response. */
const streamOf = (events: unknown[]) =>
  (async function* stream() {
    for (const event of events) yield event;
  })();

const textDelta = (delta: string) => ({
  type: "response.output_text.delta",
  delta,
});
const thinkingDelta = (delta: string) => ({
  type: "response.reasoning_text.delta",
  delta,
});

const requestSent = () =>
  createMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;

describe("lib/markdownGeneration", () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  describe("stream handling", () => {
    it("concatenates text deltas into the full document, in order", async () => {
      createMock.mockResolvedValue(
        streamOf([textDelta("# Title\n"), textDelta("Body")]),
      );

      const { fullContent } = await generateMarkdownDocument({
        prompt: "a prompt",
        label: "Doc",
        onToken: () => {},
        handle: makeTestHandle(),
      });

      expect(fullContent).toBe("# Title\nBody");
    });

    it("forwards each text delta to onToken as it arrives", async () => {
      createMock.mockResolvedValue(
        streamOf([textDelta("one"), textDelta("two")]),
      );
      const tokens: string[] = [];

      await generateMarkdownDocument({
        prompt: "p",
        label: "Doc",
        onToken: (token) => tokens.push(token),
        handle: makeTestHandle(),
      });

      expect(tokens).toEqual(["one", "two"]);
    });

    it("routes reasoning deltas to onThinking, not into the document", async () => {
      createMock.mockResolvedValue(
        streamOf([thinkingDelta("considering"), textDelta("answer")]),
      );
      const tokens: string[] = [];
      const thoughts: string[] = [];

      const { fullContent } = await generateMarkdownDocument({
        prompt: "p",
        label: "Doc",
        onToken: (token) => tokens.push(token),
        onThinking: (token) => thoughts.push(token),
        handle: makeTestHandle(),
      });

      expect(thoughts).toEqual(["considering"]);
      expect(tokens).toEqual(["answer"]);
      expect(fullContent).toBe("answer");
    });

    it("skips deltas that are empty", async () => {
      createMock.mockResolvedValue(
        streamOf([textDelta(""), textDelta("kept")]),
      );

      const { fullContent } = await generateMarkdownDocument({
        prompt: "p",
        label: "Doc",
        onToken: () => {},
        handle: makeTestHandle(),
      });

      expect(fullContent).toBe("kept");
    });

    it("ignores event types it doesn't handle", async () => {
      createMock.mockResolvedValue(
        streamOf([
          { type: "response.created" },
          { type: "response.completed" },
          textDelta("content"),
        ]),
      );

      const { fullContent } = await generateMarkdownDocument({
        prompt: "p",
        label: "Doc",
        onToken: () => {},
        handle: makeTestHandle(),
      });

      expect(fullContent).toBe("content");
    });

    it("returns an empty document for an empty stream", async () => {
      createMock.mockResolvedValue(streamOf([]));

      const { fullContent } = await generateMarkdownDocument({
        prompt: "p",
        label: "Doc",
        onToken: () => {},
        handle: makeTestHandle(),
      });

      expect(fullContent).toBe("");
    });

    it("defaults onThinking to a no-op when omitted", async () => {
      createMock.mockResolvedValue(
        streamOf([thinkingDelta("noisy"), textDelta("ok")]),
      );

      const { fullContent } = await generateMarkdownDocument({
        prompt: "p",
        label: "Doc",
        onToken: () => {},
        handle: makeTestHandle(),
      });

      expect(fullContent).toBe("ok");
    });
  });

  describe("request shape", () => {
    beforeEach(() => {
      createMock.mockResolvedValue(streamOf([]));
    });

    it("requests a stream, using the handle's model id", async () => {
      await generateMarkdownDocument({
        prompt: "p",
        label: "Doc",
        onToken: () => {},
        handle: makeTestHandle("deepseek-flash"),
      });

      expect(requestSent()).toMatchObject({
        stream: true,
        model: "deepseek-flash",
      });
    });

    it("sends the prompt as input and the label inside the instructions", async () => {
      await generateMarkdownDocument({
        prompt: "write about caching",
        label: "Caching Notes",
        onToken: () => {},
        handle: makeTestHandle(),
      });

      const request = requestSent();
      expect(request.input).toBe("write about caching");
      expect(String(request.instructions)).toContain("Caching Notes");
    });

    it("instructs the model to produce Markdown structure", async () => {
      await generateMarkdownDocument({
        prompt: "p",
        label: "Doc",
        onToken: () => {},
        handle: makeTestHandle(),
      });

      expect(String(requestSent().instructions)).toMatch(/markdown/i);
    });

    it("requests a low reasoning effort rather than the provider's default", async () => {
      // The effort is explicit because the provider default is unstated and
      // differs per provider. DeepSeek declares both `reasoning` and
      // `reasoningSummary`, so both fields are sent.
      await generateMarkdownDocument({
        prompt: "p",
        label: "Doc",
        onToken: () => {},
        handle: makeTestHandle("deepseek-flash"),
      });

      expect(requestSent().reasoning).toEqual({
        effort: "low",
        summary: "detailed",
      });
    });

    it("omits `reasoning` entirely for a model that has no such capability", async () => {
      // qwen3.8-27b declares no `reasoning`. Sending the parameter anyway is
      // a 400 on a stricter provider, so the absence is the contract.
      await generateMarkdownDocument({
        prompt: "p",
        label: "Doc",
        onToken: () => {},
        handle: makeTestHandle("qwen/qwen3.8-27b", AI_PROVIDERS.groq),
      });

      expect(requestSent()).not.toHaveProperty("reasoning");
    });

    /**
     * The "who paid" assertion: a BYOK handle must drive the model's
     * provider/model — the request body uses the handle's model id, not an
     * env var. A regression that re-introduces a module-level singleton
     * would silently revert this.
     */
    it("uses the BYOK handle's model id, not an env var", async () => {
      const handle = makeTestHandle("deepseek-flash");

      await generateMarkdownDocument({
        prompt: "p",
        label: "Doc",
        onToken: () => {},
        handle,
      });

      expect(requestSent().model).toBe("deepseek-flash");
    });
  });
});
