/**
 * @module api/__tests__/unit/markdownGeneration
 * @description The streaming Groq Markdown generator. The LLM client is mocked
 * with a synthetic event stream, so what's pinned is the stream handling: which
 * delta types accumulate into the document, which go to the "thinking" channel,
 * and what is sent upstream.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

vi.mock("../../lib/groqClient", () => ({
  default: { responses: { create: createMock } },
}));

import { generateMarkdownDocument } from "../../lib/markdownGeneration";

/** Wraps events in the async iterable the SDK returns for a streamed response. */
const streamOf = (events: unknown[]) =>
  (async function* stream() {
    for (const event of events) yield event;
  })();

const textDelta = (delta: string) => ({ type: "response.output_text.delta", delta });
const thinkingDelta = (delta: string) => ({ type: "response.reasoning_text.delta", delta });

const requestSent = () => createMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;

describe("lib/markdownGeneration", () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  describe("stream handling", () => {
    it("concatenates text deltas into the full document, in order", async () => {
      createMock.mockResolvedValue(streamOf([textDelta("# Title\n"), textDelta("Body")]));

      const { fullContent } = await generateMarkdownDocument("a prompt", "Doc", () => {});

      expect(fullContent).toBe("# Title\nBody");
    });

    it("forwards each text delta to onToken as it arrives", async () => {
      createMock.mockResolvedValue(streamOf([textDelta("one"), textDelta("two")]));
      const tokens: string[] = [];

      await generateMarkdownDocument("p", "Doc", (token) => tokens.push(token));

      expect(tokens).toEqual(["one", "two"]);
    });

    it("routes reasoning deltas to onThinking, not into the document", async () => {
      createMock.mockResolvedValue(
        streamOf([thinkingDelta("considering"), textDelta("answer")]),
      );
      const tokens: string[] = [];
      const thoughts: string[] = [];

      const { fullContent } = await generateMarkdownDocument(
        "p",
        "Doc",
        (token) => tokens.push(token),
        (token) => thoughts.push(token),
      );

      expect(thoughts).toEqual(["considering"]);
      expect(tokens).toEqual(["answer"]);
      expect(fullContent).toBe("answer");
    });

    it("skips deltas that are empty", async () => {
      createMock.mockResolvedValue(streamOf([textDelta(""), textDelta("kept")]));

      const { fullContent } = await generateMarkdownDocument("p", "Doc", () => {});

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

      const { fullContent } = await generateMarkdownDocument("p", "Doc", () => {});

      expect(fullContent).toBe("content");
    });

    it("returns an empty document for an empty stream", async () => {
      createMock.mockResolvedValue(streamOf([]));

      const { fullContent } = await generateMarkdownDocument("p", "Doc", () => {});

      expect(fullContent).toBe("");
    });

    it("defaults onThinking to a no-op when omitted", async () => {
      createMock.mockResolvedValue(streamOf([thinkingDelta("noisy"), textDelta("ok")]));

      const { fullContent } = await generateMarkdownDocument("p", "Doc", () => {});

      expect(fullContent).toBe("ok");
    });
  });

  describe("request shape", () => {
    beforeEach(() => {
      createMock.mockResolvedValue(streamOf([]));
    });

    it("requests a stream, using the configured model", async () => {
      await generateMarkdownDocument("p", "Doc", () => {});

      expect(requestSent()).toMatchObject({
        stream: true,
        model: process.env.GROQ_MODEL,
      });
    });

    it("sends the prompt as input and the label inside the instructions", async () => {
      await generateMarkdownDocument("write about caching", "Caching Notes", () => {});

      const request = requestSent();
      expect(request.input).toBe("write about caching");
      expect(String(request.instructions)).toContain("Caching Notes");
    });

    it("instructs the model to produce Markdown structure", async () => {
      await generateMarkdownDocument("p", "Doc", () => {});

      expect(String(requestSent().instructions)).toMatch(/markdown/i);
    });
  });
});
