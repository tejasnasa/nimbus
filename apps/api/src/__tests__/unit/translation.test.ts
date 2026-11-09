/**
 * @module api/__tests__/unit/translation
 * @description Caption translation: the shape of the model request, context
 * that is sent but never translated, tolerant parsing, batching, and the ways
 * translation stops. The model client is a stub (no real model is ever called);
 * Postgres and Redis are real.
 *
 * Translation is best effort, so every failure here must resolve quietly.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

import type { SegmentDTO } from "@nimbus/types";
import type { AiClientHandle } from "../../lib/ai/clientFactory";
import type { resolveAi } from "../../lib/ai/entitlements";
import { setCaptionLanguage } from "../../lib/meeting/captionLanguages";
import { toSegmentDTO } from "../../lib/meeting/segments";
import {
  TRANSLATION_BATCH_MS,
  buildTranslationInstructions,
  parseTranslations,
  translateSegments,
} from "../../lib/meeting/translation";
import {
  closeTestResources,
  createMeeting,
  createUser,
  createWorkspace,
  resetDatabase,
  testPrisma,
} from "@testhelpers";

afterAll(closeTestResources);

const handle = {
  providerId: "openai",
  modelId: "test-model",
  source: "byok",
  supportsReasoning: false,
  client: { responses: { create: createMock } },
} as unknown as AiClientHandle;

/** A resolution that hands out the stub client. */
const okResolve = vi.fn(async (input: Parameters<typeof resolveAi>[0]) => ({
  ok: true as const,
  source: "byok" as const,
  providerId: "openai" as const,
  modelId: "test-model",
  handle,
  substituted: false,
  meta: {
    workspaceId: input.workspaceId,
    userId: input.userId,
    feature: input.feature,
    providerId: "openai",
    modelId: "test-model",
    source: "byok" as const,
  },
})) as unknown as typeof resolveAi;

const reply = (translations: unknown) => ({
  output_text: JSON.stringify({ translations }),
  output: [],
});

describe("lib/meeting/translation", () => {
  let workspaceId: string;
  let userId: string;
  let meetingId: string;
  let emitted: Array<{ event: string; payload: unknown }>;
  const io = {
    to: () => ({
      emit: (event: string, payload: unknown) => {
        emitted.push({ event, payload });
        return true;
      },
    }),
  } as never;

  const addSegment = async (
    seq: number,
    text: string,
    language: string | null = null,
  ): Promise<SegmentDTO> =>
    toSegmentDTO(
      await testPrisma.transcriptSegment.create({
        data: {
          meetingId,
          seq,
          speakerName: "Mia",
          text,
          startMs: seq * 1000,
          endMs: seq * 1000 + 500,
          language,
        },
      }),
    );

  const run = (segments: SegmentDTO[], extra: object = {}) =>
    translateSegments({ id: meetingId, workspaceId }, segments, {
      io,
      resolve: okResolve,
      batchMs: 5,
      ...extra,
    });

  beforeEach(async () => {
    await resetDatabase();
    createMock.mockReset();
    vi.mocked(okResolve).mockClear();
    emitted = [];
    userId = (await createUser("Olive Owner")).id;
    workspaceId = (await createWorkspace(userId)).id;
    meetingId = (await createMeeting(workspaceId, { startedById: userId })).id;
  });

  it("asks once for every active language of the batch, as json_object", async () => {
    await setCaptionLanguage(meetingId, "s1", "hi");
    await setCaptionLanguage(meetingId, "s2", "es");
    await setCaptionLanguage(meetingId, "s3", "hi");
    const a = await addSegment(1, "Hello team", "en");
    const b = await addSegment(2, "Let us begin", "en");
    createMock.mockResolvedValue(
      reply({
        "1": { hi: "नमस्ते टीम", es: "Hola equipo" },
        "2": { hi: "शुरू करें", es: "Empecemos" },
      }),
    );

    await run([a, b]);

    expect(createMock).toHaveBeenCalledTimes(1);
    const request = createMock.mock.calls[0]![0];
    expect(request.model).toBe("test-model");
    expect(request.text).toEqual({ format: { type: "json_object" } });
    expect(request.instructions).toBe(
      buildTranslationInstructions(["es", "hi"]),
    );
    expect(JSON.parse(request.input).segments).toEqual([
      { seq: 1, speaker: "Mia", text: "Hello team", targets: ["es", "hi"] },
      { seq: 2, speaker: "Mia", text: "Let us begin", targets: ["es", "hi"] },
    ]);
    expect(okResolve).toHaveBeenCalledWith({
      workspaceId,
      userId,
      feature: "meeting",
    });
  });

  it("stores and announces each translation, and logs the call against the meeting", async () => {
    await setCaptionLanguage(meetingId, "s1", "hi");
    const a = await addSegment(1, "Hello team", "en");
    createMock.mockResolvedValue(reply({ "1": { hi: "नमस्ते टीम" } }));

    await run([a]);

    const rows = await testPrisma.segmentTranslation.findMany();
    expect(rows).toMatchObject([
      { segmentId: a.id, language: "hi", text: "नमस्ते टीम" },
    ]);
    expect(emitted).toEqual([
      {
        event: "meeting:translation",
        payload: { meetingId, seq: 1, language: "hi", text: "नमस्ते टीम" },
      },
    ]);
    const calls = await testPrisma.aiCall.findMany();
    expect(calls).toMatchObject([
      { feature: "MEETING", status: "OK", meetingId, workspaceId },
    ]);
  });

  it("overwrites an earlier translation of the same segment and language", async () => {
    await setCaptionLanguage(meetingId, "s1", "hi");
    const a = await addSegment(1, "Hello", "en");
    createMock.mockResolvedValueOnce(reply({ "1": { hi: "पुराना" } }));
    await run([a]);
    createMock.mockResolvedValueOnce(reply({ "1": { hi: "नया" } }));
    await run([a]);

    const rows = await testPrisma.segmentTranslation.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.text).toBe("नया");
  });

  it("sends the previous three segments as context and does not translate them", async () => {
    await setCaptionLanguage(meetingId, "s1", "fr");
    for (let seq = 1; seq <= 5; seq++)
      await addSegment(seq, `line ${seq}`, "en");
    const target = await addSegment(6, "it ships Friday", "en");
    createMock.mockResolvedValue(reply({ "6": { fr: "il sort vendredi" } }));

    await run([target]);

    const sent = JSON.parse(createMock.mock.calls[0]![0].input);
    expect(sent.context.map((c: { seq: number }) => c.seq)).toEqual([3, 4, 5]);
    expect(sent.segments.map((s: { seq: number }) => s.seq)).toEqual([6]);
    expect(buildTranslationInstructions(["fr"])).toContain(
      "never translate them",
    );
    expect(await testPrisma.segmentTranslation.count()).toBe(1);
  });

  it("leaves out a segment's own language, and assumes English when it is untagged", async () => {
    await setCaptionLanguage(meetingId, "s1", "en");
    await setCaptionLanguage(meetingId, "s2", "hi");
    const spoken = await addSegment(1, "नमस्ते", "hi");
    const untagged = await addSegment(2, "Hello", null);
    createMock.mockResolvedValue(reply({ "1": { en: "Hello" } }));

    await run([spoken, untagged]);

    const sent = JSON.parse(createMock.mock.calls[0]![0].input);
    expect(sent.segments).toEqual([
      expect.objectContaining({ seq: 1, targets: ["en"] }),
      expect.objectContaining({ seq: 2, targets: ["hi"] }),
    ]);
  });

  it("makes no call when nobody wants a language the segments are not already in", async () => {
    const english = await addSegment(1, "Hello", "en");
    await run([english]);
    await setCaptionLanguage(meetingId, "s1", "en");
    await run([english]);

    expect(createMock).not.toHaveBeenCalled();
    expect(okResolve).not.toHaveBeenCalled();
  });

  it("keeps what parsed when the reply is only partly usable", async () => {
    await setCaptionLanguage(meetingId, "s1", "hi");
    await setCaptionLanguage(meetingId, "s2", "es");
    const a = await addSegment(1, "one", "en");
    const b = await addSegment(2, "two", "en");
    createMock.mockResolvedValue(
      reply({
        "1": { hi: "एक", es: "" },
        "2": { es: 4, fr: "not requested" },
        "99": { hi: "unknown segment" },
        junk: { hi: "x" },
      }),
    );

    await run([a, b]);

    const rows = await testPrisma.segmentTranslation.findMany();
    expect(rows.map((r) => [r.segmentId, r.language, r.text])).toEqual([
      [a.id, "hi", "एक"],
    ]);
  });

  it("is non-fatal when the model call fails, and records the failure", async () => {
    await setCaptionLanguage(meetingId, "s1", "hi");
    const a = await addSegment(1, "Hello", "en");
    createMock.mockRejectedValue(new Error("upstream said sk-secret"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(run([a])).resolves.toBeUndefined();

    expect(await testPrisma.segmentTranslation.count()).toBe(0);
    expect(emitted).toEqual([]);
    expect(await testPrisma.aiCall.findMany()).toMatchObject([
      { feature: "MEETING", status: "ERROR" },
    ]);
    expect(JSON.stringify(logged.mock.calls)).not.toContain("sk-secret");
    logged.mockRestore();
  });

  it("is non-fatal when the reply is not JSON", async () => {
    await setCaptionLanguage(meetingId, "s1", "hi");
    const a = await addSegment(1, "Hello", "en");
    createMock.mockResolvedValue({
      output_text: "sorry, I cannot",
      output: [],
    });

    await expect(run([a])).resolves.toBeUndefined();
    expect(await testPrisma.segmentTranslation.count()).toBe(0);
  });

  it("reads the reply from the output items when output_text is absent", async () => {
    await setCaptionLanguage(meetingId, "s1", "hi");
    const a = await addSegment(1, "Hello", "en");
    createMock.mockResolvedValue({
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: '```json\n{"translations":{"1":{"hi":"नमस्ते"}}}\n```',
            },
          ],
        },
      ],
    });

    await run([a]);
    expect(await testPrisma.segmentTranslation.count()).toBe(1);
  });

  it("translates segments arriving within the window together, in sequence order", async () => {
    await setCaptionLanguage(meetingId, "s1", "hi");
    const a = await addSegment(1, "one", "en");
    const b = await addSegment(2, "two", "en");
    createMock.mockResolvedValue(
      reply({ "1": { hi: "एक" }, "2": { hi: "दो" } }),
    );

    const first = run([b], { batchMs: 40 });
    const second = run([a], { batchMs: 40 });
    await Promise.all([first, second]);

    expect(createMock).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(createMock.mock.calls[0]![0].input);
    expect(sent.segments.map((s: { seq: number }) => s.seq)).toEqual([1, 2]);
    expect(await testPrisma.segmentTranslation.count()).toBe(2);
  });

  it("waits the 400 ms window by default and starts a new batch after it", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      await setCaptionLanguage(meetingId, "s1", "hi");
      const a = await addSegment(1, "one", "en");
      createMock.mockResolvedValue(reply({ "1": { hi: "एक" } }));

      const done = translateSegments({ id: meetingId, workspaceId }, [a], {
        io,
        resolve: okResolve,
      });
      await vi.advanceTimersByTimeAsync(TRANSLATION_BATCH_MS - 1);
      expect(okResolve).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      vi.useRealTimers();
      await done;
      expect(createMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops once the meeting has ended", async () => {
    await setCaptionLanguage(meetingId, "s1", "hi");
    const a = await addSegment(1, "Hello", "en");
    await testPrisma.meeting.update({
      where: { id: meetingId },
      data: { status: "ENDED", endedAt: new Date() },
    });

    await run([a]);

    expect(createMock).not.toHaveBeenCalled();
    expect(okResolve).not.toHaveBeenCalled();
  });

  it("stops when the spend cap refuses the call, and logs the refusal once", async () => {
    await setCaptionLanguage(meetingId, "s1", "hi");
    const a = await addSegment(1, "Hello", "en");
    const b = await addSegment(2, "Again", "en");
    const refuse = vi.fn(async () => ({
      ok: false as const,
      reason: "spend-cap-reached" as const,
      message: "capped",
      cta: "manage-ai" as const,
    })) as unknown as typeof resolveAi;
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await run([a], { resolve: refuse });
    await run([b], { resolve: refuse });

    expect(createMock).not.toHaveBeenCalled();
    expect(refuse).toHaveBeenCalledTimes(2);
    expect(await testPrisma.aiCall.findMany()).toMatchObject([
      {
        feature: "MEETING",
        status: "REFUSED",
        errorReason: "spend-cap-reached",
      },
    ]);
    logged.mockRestore();
  });

  it("does nothing for a meeting with no starter to charge", async () => {
    await testPrisma.meeting.update({
      where: { id: meetingId },
      data: { startedById: null },
    });
    await setCaptionLanguage(meetingId, "s1", "hi");
    const a = await addSegment(1, "Hello", "en");

    await run([a]);
    expect(okResolve).not.toHaveBeenCalled();
  });

  it("resolves immediately for an empty batch", async () => {
    await expect(run([])).resolves.toBeUndefined();
  });
});

describe("parseTranslations", () => {
  it("returns nothing for text without an object or with a wrong shape", () => {
    expect(parseTranslations("no json").size).toBe(0);
    expect(parseTranslations('{"translations":[]}').size).toBe(0);
    expect(parseTranslations('{"other":1}').size).toBe(0);
    expect(parseTranslations('{"translations": {').size).toBe(0);
  });
});
