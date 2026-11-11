/**
 * @module api/__tests__/integration/persistence/rollingSummary
 * @description The running summary of a live meeting: when a roll is due, that
 * the Redis lock lets only one run, that a failed or foreign roll leaves the
 * stored summary alone, and that "catch me up" regenerates only a stale summary
 * with new captions behind it. The model is a stub.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

import { pubClient } from "../../../lib/redis";
import {
  CATCH_UP_STALE_MS,
  getCatchUp,
  isRollDue,
  maybeRoll,
  ROLL_MIN_INTERVAL_MS,
  ROLL_MIN_SEGMENTS,
  rollLockKey,
} from "../../../lib/meeting/rollingSummary";
import {
  closeTestResources,
  createMeeting,
  createUser,
  createWorkspace,
  modelReply,
  resetDatabase,
  seedTranscript,
  stubResolver,
  testPrisma,
} from "@testhelpers";

afterAll(closeTestResources);

const lines = (count: number, from = 1) =>
  Array.from({ length: count }, (_, i) => ({
    speakerName: "Priya",
    text: `line ${from + i}`,
  }));

describe("isRollDue", () => {
  it("is due at 20 new segments, or 3 minutes with at least one", () => {
    expect(isRollDue(ROLL_MIN_SEGMENTS - 1, 1000)).toBe(false);
    expect(isRollDue(ROLL_MIN_SEGMENTS, 0)).toBe(true);
    expect(isRollDue(0, ROLL_MIN_INTERVAL_MS * 10)).toBe(false);
    expect(isRollDue(1, ROLL_MIN_INTERVAL_MS - 1)).toBe(false);
    expect(isRollDue(1, ROLL_MIN_INTERVAL_MS)).toBe(true);
  });
});

describe("persistence: rolling summary", () => {
  let workspaceId: string;
  let meetingId: string;
  const startedAt = new Date("2026-11-09T09:00:00Z");
  const minutesIn = (minutes: number) => startedAt.getTime() + minutes * 60_000;

  const deps = (now: number) => ({
    resolve: stubResolver(createMock),
    now: () => now,
  });
  const reload = () =>
    testPrisma.meeting.findUniqueOrThrow({ where: { id: meetingId } });

  beforeEach(async () => {
    createMock.mockReset();
    createMock.mockResolvedValue(modelReply("- first topic\n- decision"));
    await resetDatabase();
    const starter = await createUser("Priya Shah");
    workspaceId = (await createWorkspace(starter.id)).id;
    meetingId = (
      await createMeeting(workspaceId, {
        startedById: starter.id,
        startedAt,
      })
    ).id;
  });

  describe("maybeRoll", () => {
    it("waits below 20 new captions inside three minutes", async () => {
      await seedTranscript(meetingId, lines(19));

      expect(await maybeRoll(meetingId, deps(minutesIn(2)))).toBe("not-due");
      expect(createMock).not.toHaveBeenCalled();
      expect((await reload()).rollingSummary).toBeNull();
    });

    it("rolls at 20 new captions and records the position", async () => {
      await seedTranscript(meetingId, lines(20));

      expect(await maybeRoll(meetingId, deps(minutesIn(1)))).toBe("rolled");

      const meeting = await reload();
      expect(meeting.rollingSummary).toBe("- first topic\n- decision");
      expect(meeting.rollingSummarySeq).toBe(20);
      expect(meeting.rollingSummaryAt?.getTime()).toBe(minutesIn(1));
      const request = createMock.mock.calls[0]![0] as {
        input: string;
        instructions: string;
      };
      expect(request.input).toContain("Previous summary:\n(none yet)");
      expect(request.input).toContain("Priya: line 20");
      expect(request.instructions).toContain("150 words");
    });

    it("rolls after three minutes when there is at least one new caption", async () => {
      await seedTranscript(meetingId, lines(1));

      expect(await maybeRoll(meetingId, deps(minutesIn(3)))).toBe("rolled");
      expect((await reload()).rollingSummarySeq).toBe(1);
    });

    it("sends the previous summary and only the captions since", async () => {
      await seedTranscript(meetingId, lines(1));
      await maybeRoll(meetingId, deps(minutesIn(3)));
      await testPrisma.transcriptSegment.create({
        data: {
          meetingId,
          seq: 2,
          speakerName: "Tom",
          text: "second thing",
          startMs: 5000,
          endMs: 6000,
        },
      });
      createMock.mockResolvedValue(modelReply("- updated"));

      expect(await maybeRoll(meetingId, deps(minutesIn(7)))).toBe("rolled");

      const request = createMock.mock.calls[1]![0] as { input: string };
      expect(request.input).toContain("- first topic");
      expect(request.input).toContain("Tom: second thing");
      expect(request.input).not.toContain("line 1");
      expect((await reload()).rollingSummary).toBe("- updated");
      expect((await reload()).rollingSummarySeq).toBe(2);
    });

    it("does nothing with no new captions", async () => {
      expect(await maybeRoll(meetingId, deps(minutesIn(30)))).toBe("not-due");
      expect(createMock).not.toHaveBeenCalled();
    });

    it("leaves a meeting that is not live alone", async () => {
      await seedTranscript(meetingId, lines(25));
      await testPrisma.meeting.update({
        where: { id: meetingId },
        data: { status: "ENDED" },
      });

      expect(await maybeRoll(meetingId, deps(minutesIn(5)))).toBe("ignored");
      expect(await maybeRoll("missing", deps(minutesIn(5)))).toBe("ignored");
      expect(createMock).not.toHaveBeenCalled();
    });

    it("lets a held lock stop the roll", async () => {
      await seedTranscript(meetingId, lines(25));
      await pubClient.set(rollLockKey(meetingId), "1", "EX", 60);

      expect(await maybeRoll(meetingId, deps(minutesIn(5)))).toBe("locked");
      expect(createMock).not.toHaveBeenCalled();
    });

    it("prevents a double roll when two run at once, and frees the lock", async () => {
      await seedTranscript(meetingId, lines(25));
      createMock.mockImplementation(async () => {
        await new Promise((resolveTimer) => setTimeout(resolveTimer, 60));
        return modelReply("- once");
      });

      const outcomes = await Promise.all([
        maybeRoll(meetingId, deps(minutesIn(5))),
        maybeRoll(meetingId, deps(minutesIn(5))),
      ]);

      expect([...outcomes].sort()).toEqual(["locked", "rolled"]);
      expect(createMock).toHaveBeenCalledTimes(1);
      expect(await pubClient.exists(rollLockKey(meetingId))).toBe(0);
    });

    it("keeps the stored summary when the model fails, and frees the lock", async () => {
      await seedTranscript(meetingId, lines(25));
      await testPrisma.meeting.update({
        where: { id: meetingId },
        data: { rollingSummary: "- old", rollingSummarySeq: 0 },
      });
      createMock.mockRejectedValue(new Error("down"));

      expect(await maybeRoll(meetingId, deps(minutesIn(5)))).toBe("failed");

      const meeting = await reload();
      expect(meeting.rollingSummary).toBe("- old");
      expect(meeting.rollingSummarySeq).toBe(0);
      expect(await pubClient.exists(rollLockKey(meetingId))).toBe(0);
    });

    it("never moves the position backwards when a slower roll finishes late", async () => {
      await seedTranscript(meetingId, lines(25));
      createMock.mockImplementation(async () => {
        await testPrisma.meeting.update({
          where: { id: meetingId },
          data: { rollingSummarySeq: 40, rollingSummary: "- newer" },
        });
        return modelReply("- stale");
      });

      expect(await maybeRoll(meetingId, deps(minutesIn(5)))).toBe("ignored");
      expect((await reload()).rollingSummary).toBe("- newer");
    });
  });

  describe("getCatchUp", () => {
    it("regenerates a stale summary when captions have arrived", async () => {
      await seedTranscript(meetingId, lines(3));
      await testPrisma.meeting.update({
        where: { id: meetingId },
        data: {
          rollingSummary: "- old",
          rollingSummarySeq: 0,
          rollingSummaryAt: new Date(minutesIn(1)),
        },
      });
      const now = minutesIn(1) + CATCH_UP_STALE_MS + 1000;

      const result = await getCatchUp(meetingId, deps(now));

      expect(createMock).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        summary: "- first topic\n- decision",
        upToSeq: 3,
        generatedAt: new Date(now).toISOString(),
        minutesElapsed: 2,
      });
    });

    it("returns the stored summary while it is fresh, even with new captions", async () => {
      await seedTranscript(meetingId, lines(3));
      await testPrisma.meeting.update({
        where: { id: meetingId },
        data: {
          rollingSummary: "- stored",
          rollingSummarySeq: 1,
          rollingSummaryAt: new Date(minutesIn(1)),
        },
      });

      const result = await getCatchUp(
        meetingId,
        deps(minutesIn(1) + CATCH_UP_STALE_MS - 1000),
      );

      expect(createMock).not.toHaveBeenCalled();
      expect(result).toMatchObject({ summary: "- stored", upToSeq: 1 });
    });

    it("returns the stored summary when stale but nothing new was said", async () => {
      await seedTranscript(meetingId, lines(2));
      await testPrisma.meeting.update({
        where: { id: meetingId },
        data: {
          rollingSummary: "- stored",
          rollingSummarySeq: 2,
          rollingSummaryAt: new Date(minutesIn(1)),
        },
      });

      const result = await getCatchUp(meetingId, deps(minutesIn(20)));

      expect(createMock).not.toHaveBeenCalled();
      expect(result?.summary).toBe("- stored");
      expect(result?.minutesElapsed).toBe(20);
    });

    it("returns the stored summary when another roll holds the lock", async () => {
      await seedTranscript(meetingId, lines(3));
      await pubClient.set(rollLockKey(meetingId), "1", "EX", 60);

      const result = await getCatchUp(meetingId, deps(minutesIn(10)));

      expect(createMock).not.toHaveBeenCalled();
      expect(result?.summary).toBeNull();
    });

    it("reports nothing yet for a meeting with no captions", async () => {
      expect(await getCatchUp(meetingId, deps(minutesIn(4)))).toEqual({
        summary: null,
        upToSeq: 0,
        generatedAt: null,
        minutesElapsed: 4,
      });
      expect(createMock).not.toHaveBeenCalled();
    });

    it("stops the clock at the end of a finished meeting and falls back to its notes", async () => {
      await testPrisma.meeting.update({
        where: { id: meetingId },
        data: {
          status: "SUMMARIZED",
          endedAt: new Date(minutesIn(12)),
          summary: { summary: "The final notes." },
        },
      });

      const result = await getCatchUp(meetingId, deps(minutesIn(500)));

      expect(result).toMatchObject({
        summary: "The final notes.",
        minutesElapsed: 12,
      });
      expect(createMock).not.toHaveBeenCalled();
    });

    it("returns null for a missing meeting", async () => {
      expect(await getCatchUp("missing", deps(0))).toBeNull();
    });
  });
});
