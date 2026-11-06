/**
 * @module api/__tests__/unit/imageCanvas
 * @description Image → canvas generation (`lib/imageCanvas`), driven with a
 * scripted provider stream. Nothing here reaches a provider or fetches the
 * image: the SDK client is a mock and the image URL is only ever a string in
 * the request body.
 *
 * What it pins: the request contract (image part at low detail, JSON mode, the
 * token cap, the transcribe-don't-improve wording), the three outcomes (a
 * diagram, "not a diagram", an unreadable answer) and that each is written to
 * the call log with the right status and reason. The call log is the real one,
 * against the test database.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

import { AI_PROVIDERS, modelById } from "@nimbus/types";
import { AiCallError, type AiCallMeta } from "../../lib/ai/callLog";
import type { AiClientHandle } from "../../lib/ai/clientFactory";
import { generateCanvasFromImage } from "../../lib/imageCanvas";
import {
  closeTestResources,
  createUser,
  createWorkspace,
  resetDatabase,
  testPrisma,
} from "@testhelpers";

afterAll(closeTestResources);

const IMAGE =
  "https://res.cloudinary.com/test/image/upload/v1/nimbus/chat/ws/pic.jpg";

const makeHandle = (): AiClientHandle => {
  const provider = AI_PROVIDERS.deepseek;
  const model = modelById(provider, "deepseek-flash")!;
  return {
    providerId: provider.id,
    modelId: model.id,
    source: "free",
    supportsReasoning: true,
    client: {
      responses: { create: createMock },
    } as unknown as AiClientHandle["client"],
  };
};

/** A scripted stream: optional reasoning, the text, then completion. */
const streamOf = (text: string, opts: { reasoning?: string } = {}) =>
  (async function* stream() {
    if (opts.reasoning) {
      yield { type: "response.reasoning_text.delta", delta: opts.reasoning };
    }
    yield { type: "response.output_text.delta", delta: text };
    yield {
      type: "response.completed",
      response: {
        output: [],
        usage: {
          input_tokens: 700,
          output_tokens: 90,
          output_tokens_details: { reasoning_tokens: 30 },
        },
      },
    };
  })();

const DIAGRAM = {
  direction: "TB",
  nodes: [
    { id: "a", shape: "rectangle", label: "Client" },
    { id: "b", shape: "diamond", label: "Cached?" },
    { id: "c", shape: "ellipse", label: "Database" },
  ],
  edges: [
    { from: "a", to: "b" },
    { from: "b", to: "c" },
  ],
};

describe("lib/imageCanvas", () => {
  let meta: AiCallMeta;
  let workspaceId: string;
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    createMock.mockReset();
    userId = (await createUser("Ada")).id;
    workspaceId = (await createWorkspace(userId)).id;
    meta = {
      workspaceId,
      userId,
      feature: "vision",
      providerId: "deepseek",
      modelId: "deepseek-flash",
      source: "free",
    };
  });

  describe("the request", () => {
    it("sends the image at low detail, as JSON, with the canvas token cap", async () => {
      createMock.mockResolvedValue(streamOf(JSON.stringify(DIAGRAM)));

      await generateCanvasFromImage({
        handle: makeHandle(),
        imageUrl: IMAGE,
        instruction: "make it tidy",
      });

      const args = createMock.mock.calls[0]![0];
      expect(args).toMatchObject({
        model: "deepseek-flash",
        stream: true,
        text: { format: { type: "json_object" } },
        max_output_tokens: 16_384,
        reasoning: { effort: "low" },
      });
      expect(args.input).toEqual([
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: expect.stringContaining("make it tidy"),
            },
            { type: "input_image", image_url: IMAGE, detail: "low" },
          ],
        },
      ]);
    });

    it("tells the model to transcribe, keep labels verbatim and report a non-diagram", async () => {
      createMock.mockResolvedValue(streamOf(JSON.stringify(DIAGRAM)));

      await generateCanvasFromImage({ handle: makeHandle(), imageUrl: IMAGE });

      const { instructions } = createMock.mock.calls[0]![0];
      expect(instructions).toContain("do not improve it");
      expect(instructions).toContain("Copy each label exactly as written");
      expect(instructions).toContain('"notADiagram":true');
      expect(instructions).toContain('"direction"');
    });

    it("passes the abort signal to the provider call", async () => {
      createMock.mockResolvedValue(streamOf(JSON.stringify(DIAGRAM)));
      const controller = new AbortController();

      await generateCanvasFromImage({
        handle: makeHandle(),
        imageUrl: IMAGE,
        signal: controller.signal,
      });

      expect(createMock.mock.calls[0]![1]).toEqual({
        signal: controller.signal,
      });
    });
  });

  describe("a diagram", () => {
    it("returns Excalidraw elements laid out in the model's direction", async () => {
      createMock.mockResolvedValue(streamOf(JSON.stringify(DIAGRAM)));
      const statuses: string[] = [];

      const result = await generateCanvasFromImage({
        handle: makeHandle(),
        imageUrl: IMAGE,
        onStatus: (s) => statuses.push(s),
      });

      expect(result.kind).toBe("diagram");
      if (result.kind !== "diagram") return;
      const shapes = result.canvasData as Array<{
        type: string;
        x: number;
        y: number;
      }>;
      expect(shapes.filter((e) => e.type === "arrow")).toHaveLength(2);
      // Top-to-bottom: the three shapes share a column and descend.
      const boxes = shapes.filter(
        (e) =>
          e.type === "rectangle" ||
          e.type === "diamond" ||
          e.type === "ellipse",
      );
      expect(new Set(boxes.map((b) => b.x)).size).toBe(1);
      expect(boxes[1]!.y).toBeGreaterThan(boxes[0]!.y);
      expect(statuses[0]).toMatch(/Reading the image/);
      expect(statuses.at(-1)).toMatch(/^Done — \d+ canvas elements$/);
    });

    it("relays reasoning and keeps it as the thinking log", async () => {
      createMock.mockResolvedValue(
        streamOf(JSON.stringify(DIAGRAM), { reasoning: "three boxes" }),
      );
      const tokens: string[] = [];

      const result = await generateCanvasFromImage({
        handle: makeHandle(),
        imageUrl: IMAGE,
        onReasoning: (t) => tokens.push(t),
      });

      expect(tokens).toEqual(["three boxes"]);
      expect(result).toMatchObject({
        kind: "diagram",
        thinking: "three boxes",
      });
    });

    it("writes one OK vision row with the reported usage", async () => {
      createMock.mockResolvedValue(streamOf(JSON.stringify(DIAGRAM)));

      await generateCanvasFromImage({
        handle: makeHandle(),
        imageUrl: IMAGE,
        callMeta: meta,
      });

      const rows = await testPrisma.aiCall.findMany({ where: { workspaceId } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        feature: "VISION",
        status: "OK",
        userId,
        providerId: "deepseek",
        inputTokens: 700,
        outputTokens: 90,
        reasoningTokens: 30,
      });
    });

    it("accepts the JSON wrapped in a fence", async () => {
      createMock.mockResolvedValue(
        streamOf("```json\n" + JSON.stringify(DIAGRAM) + "\n```"),
      );

      const result = await generateCanvasFromImage({
        handle: makeHandle(),
        imageUrl: IMAGE,
      });

      expect(result.kind).toBe("diagram");
    });
  });

  describe("how the answer arrives", () => {
    const completed = (text: string) => ({
      type: "response.completed",
      response: {
        output: [
          { type: "reasoning" },
          { type: "message" },
          {
            type: "message",
            content: [{ type: "refusal" }, { type: "output_text", text }],
          },
        ],
      },
    });

    it("reads the final snapshot when the stream carried no text deltas", async () => {
      createMock.mockResolvedValue(
        (async function* stream() {
          yield completed(JSON.stringify(DIAGRAM));
        })(),
      );

      const result = await generateCanvasFromImage({
        handle: makeHandle(),
        imageUrl: IMAGE,
      });

      expect(result.kind).toBe("diagram");
    });

    it("adopts the done event's text when it extends what the deltas gave", async () => {
      const text = JSON.stringify(DIAGRAM);
      createMock.mockResolvedValue(
        (async function* stream() {
          yield {
            type: "response.output_text.delta",
            delta: text.slice(0, 20),
          };
          yield { type: "response.output_text.done", text };
        })(),
      );

      const result = await generateCanvasFromImage({
        handle: makeHandle(),
        imageUrl: IMAGE,
      });

      expect(result.kind).toBe("diagram");
    });

    it("relays reasoning summaries as well as raw reasoning", async () => {
      createMock.mockResolvedValue(
        (async function* stream() {
          yield {
            type: "response.reasoning_summary_text.delta",
            delta: "summary ",
          };
          yield {
            type: "response.output_text.delta",
            delta: JSON.stringify(DIAGRAM),
          };
        })(),
      );
      const tokens: string[] = [];

      await generateCanvasFromImage({
        handle: makeHandle(),
        imageUrl: IMAGE,
        onReasoning: (t) => tokens.push(t),
      });

      expect(tokens).toEqual(["summary "]);
    });

    it("sends the bare instruction when the user gave none", async () => {
      createMock.mockResolvedValue(streamOf(JSON.stringify(DIAGRAM)));

      await generateCanvasFromImage({
        handle: makeHandle(),
        imageUrl: IMAGE,
        instruction: "   ",
      });

      expect(createMock.mock.calls[0]![0].input[0].content[0].text).toBe(
        "Create the diagram shown in this image as a JSON object.",
      );
    });
  });

  describe("an image that is not a diagram", () => {
    it("resolves to the model's reason instead of failing", async () => {
      createMock.mockResolvedValue(
        streamOf(
          JSON.stringify({ notADiagram: true, reason: "a cat on a sofa" }),
        ),
      );

      const result = await generateCanvasFromImage({
        handle: makeHandle(),
        imageUrl: IMAGE,
        callMeta: meta,
      });

      expect(result).toEqual({
        kind: "not-a-diagram",
        reason: "a cat on a sofa",
      });
      const rows = await testPrisma.aiCall.findMany({ where: { workspaceId } });
      expect(rows.map((r) => r.status)).toEqual(["OK"]);
    });

    it("also understands the older notDiagram spelling", async () => {
      createMock.mockResolvedValue(
        streamOf(
          JSON.stringify({
            nodes: [],
            edges: [],
            notDiagram: true,
            reason: "x",
          }),
        ),
      );

      const result = await generateCanvasFromImage({
        handle: makeHandle(),
        imageUrl: IMAGE,
      });

      expect(result).toEqual({ kind: "not-a-diagram", reason: "x" });
    });

    it("supplies a reason when the model gives none, and caps a long one", async () => {
      createMock.mockResolvedValueOnce(
        streamOf(JSON.stringify({ notADiagram: true })),
      );
      const bare = await generateCanvasFromImage({
        handle: makeHandle(),
        imageUrl: IMAGE,
      });
      expect(bare).toMatchObject({ kind: "not-a-diagram" });
      expect((bare as { reason: string }).reason.length).toBeGreaterThan(0);

      createMock.mockResolvedValueOnce(
        streamOf(
          JSON.stringify({ notADiagram: true, reason: "y".repeat(900) }),
        ),
      );
      const long = await generateCanvasFromImage({
        handle: makeHandle(),
        imageUrl: IMAGE,
      });
      expect((long as { reason: string }).reason).toHaveLength(200);
    });
  });

  describe("failures", () => {
    it("turns an unreadable answer into a curated parse-failed error and logs it", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      createMock.mockResolvedValue(streamOf("I could not make that out."));

      const error = await generateCanvasFromImage({
        handle: makeHandle(),
        imageUrl: IMAGE,
        callMeta: meta,
      }).catch((e) => e);

      expect(error).toBeInstanceOf(AiCallError);
      expect(error.reason).toBe("parse-failed");
      expect(error.message).toMatch(/couldn't read a diagram/);
      const rows = await testPrisma.aiCall.findMany({ where: { workspaceId } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        status: "ERROR",
        errorReason: "parse-failed",
      });
    });

    it("treats an empty answer the same way", async () => {
      createMock.mockResolvedValue(streamOf(""));

      await expect(
        generateCanvasFromImage({ handle: makeHandle(), imageUrl: IMAGE }),
      ).rejects.toMatchObject({ reason: "parse-failed" });
    });

    it("rejects a payload whose nodes are empty", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      createMock.mockResolvedValue(streamOf('{"nodes":[],"edges":[]}'));

      await expect(
        generateCanvasFromImage({ handle: makeHandle(), imageUrl: IMAGE }),
      ).rejects.toMatchObject({ reason: "parse-failed" });
    });

    it("records a provider failure without storing its text", async () => {
      createMock.mockRejectedValue(new Error("sk-secret-in-the-error"));

      await expect(
        generateCanvasFromImage({
          handle: makeHandle(),
          imageUrl: IMAGE,
          callMeta: meta,
        }),
      ).rejects.toThrow();

      const rows = await testPrisma.aiCall.findMany({ where: { workspaceId } });
      expect(rows[0]).toMatchObject({ status: "ERROR" });
      expect(JSON.stringify(rows)).not.toContain("sk-secret");
    });

    it("records an abort as cancelled", async () => {
      const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
      createMock.mockRejectedValue(abort);

      await expect(
        generateCanvasFromImage({
          handle: makeHandle(),
          imageUrl: IMAGE,
          callMeta: meta,
        }),
      ).rejects.toThrow("aborted");

      const rows = await testPrisma.aiCall.findMany({ where: { workspaceId } });
      expect(rows[0]).toMatchObject({
        status: "CANCELLED",
        errorReason: "cancelled",
      });
    });
  });
});
