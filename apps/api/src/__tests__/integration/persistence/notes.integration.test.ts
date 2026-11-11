/**
 * @module api/__tests__/integration/persistence/notes.integration
 * @description Meeting notes against a real database: the rows, the document and
 * the status land together or not at all, a rerun changes nothing, a short
 * meeting is closed without a document, a failure keeps the transcript, a
 * meeting deleted mid-run is left alone, and the recovery sweep retries and
 * then stops at three attempts. The model is a stub.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

import {
  clearScheduledNotes,
  NOTES_MAX_ATTEMPTS,
  scheduleNotes,
  writeNotes,
} from "../../../lib/meeting/notes";
import { recoverPendingNotes } from "../../../lib/meeting/recovery";
import { endMeeting } from "../../../lib/meeting/lifecycle";
import {
  addMember,
  closeTestResources,
  createMeeting,
  createUser,
  createWorkspace,
  modelReply,
  refusingResolver,
  resetDatabase,
  SAMPLE_LINES,
  sampleNotes,
  seedTranscript,
  stubResolver,
  testPrisma,
} from "@testhelpers";

afterAll(closeTestResources);

describe("persistence: meeting notes", () => {
  let workspaceId: string;
  let starterId: string;
  let tomId: string;
  let meetingId: string;
  let segmentIds: string[];

  const resolve = () => stubResolver(createMock);

  beforeEach(async () => {
    clearScheduledNotes();
    createMock.mockReset();
    await resetDatabase();
    starterId = (await createUser("Priya Shah")).id;
    tomId = (await createUser("Tom Brandt")).id;
    workspaceId = (await createWorkspace(starterId)).id;
    await addMember(workspaceId, tomId, "MEMBER");
    meetingId = (
      await createMeeting(workspaceId, {
        startedById: starterId,
        status: "ENDED",
        startedAt: new Date("2026-11-09T09:00:00Z"),
        endedAt: new Date(Date.now() - 5 * 60_000),
      })
    ).id;
    await testPrisma.meeting.update({
      where: { id: meetingId },
      data: { endReason: "stopped" },
    });
    segmentIds = await seedTranscript(meetingId, SAMPLE_LINES);
  });

  it("stores the decisions, action items, document and status together", async () => {
    createMock.mockResolvedValue(modelReply(sampleNotes()));

    expect(await writeNotes(meetingId, { resolve: resolve() })).toBe("written");

    const meeting = await testPrisma.meeting.findUniqueOrThrow({
      where: { id: meetingId },
    });
    expect(meeting.status).toBe("SUMMARIZED");
    expect(meeting.title).toBe("Beta launch planning");
    expect(meeting.summaryAttempts).toBe(1);
    expect(meeting.failureReason).toBeNull();
    expect((meeting.summary as { topics: string[] }).topics).toEqual([
      "beta launch",
      "rollback",
    ]);

    const document = await testPrisma.document.findUniqueOrThrow({
      where: { id: meeting.notesDocumentId! },
    });
    expect(document.type).toBe("MARKDOWN");
    expect(document.workspaceId).toBe(workspaceId);
    expect(document.title).toBe(
      "Meeting notes: Beta launch planning (2026-11-09)",
    );
    expect(document.initialContent).toContain(
      "- [ ] Update the changelog (**Tom Brandt**, due 2026-11-13)",
    );
    expect(document.initialContent).toContain("Full transcript in Meetings.");

    const decisions = await testPrisma.decision.findMany({
      where: { meetingId },
    });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      workspaceId,
      text: "Ship the beta on Friday",
      sourceSegmentId: segmentIds[0],
    });

    const items = await testPrisma.actionItem.findMany({
      where: { meetingId },
      orderBy: { createdAt: "asc" },
    });
    const byText = new Map(items.map((item) => [item.text, item]));
    expect(byText.get("Update the changelog")).toMatchObject({
      workspaceId,
      ownerUserId: tomId,
      ownerName: "Tom",
      status: "OPEN",
      sourceSegmentId: segmentIds[1],
    });
    expect(
      byText.get("Update the changelog")!.dueDate!.toISOString().slice(0, 10),
    ).toBe("2026-11-13");
    expect(byText.get("Write the rollback plan")).toMatchObject({
      ownerUserId: starterId,
      dueDate: null,
    });
  });

  it("keeps the spoken name when it matches nobody or more than one member", async () => {
    const second = await createUser("Tom Okafor");
    await addMember(workspaceId, second.id, "MEMBER");
    createMock.mockResolvedValue(
      modelReply(
        sampleNotes({
          actionItems: [
            { text: "Ambiguous", ownerName: "Tom" },
            { text: "Nobody", ownerName: "Zed" },
            { text: "Unowned" },
          ],
        }),
      ),
    );

    await writeNotes(meetingId, { resolve: resolve() });

    const items = await testPrisma.actionItem.findMany({
      where: { meetingId },
    });
    expect(items).toHaveLength(3);
    expect(items.find((i) => i.text === "Ambiguous")).toMatchObject({
      ownerUserId: null,
      ownerName: "Tom",
    });
    expect(items.find((i) => i.text === "Nobody")).toMatchObject({
      ownerUserId: null,
      ownerName: "Zed",
    });
    expect(items.find((i) => i.text === "Unowned")).toMatchObject({
      ownerUserId: null,
      ownerName: null,
    });
  });

  it("rolls everything back when the transaction fails part way", async () => {
    // Year 0000 passes validation but is not a date Postgres can store, so the
    // action item insert fails after the document has been created.
    createMock.mockResolvedValue(
      modelReply(
        sampleNotes({
          actionItems: [{ text: "Impossible", due: "0000-01-01" }],
        }),
      ),
    );

    const outcome = await writeNotes(meetingId, { resolve: resolve() });

    expect(outcome).toBe("failed");
    const meeting = await testPrisma.meeting.findUniqueOrThrow({
      where: { id: meetingId },
    });
    expect(meeting.status).toBe("FAILED");
    expect(meeting.summary).toBeNull();
    expect(meeting.notesDocumentId).toBeNull();
    expect(await testPrisma.document.count()).toBe(0);
    expect(await testPrisma.decision.count()).toBe(0);
    expect(await testPrisma.actionItem.count()).toBe(0);
    expect(
      await testPrisma.transcriptSegment.count({ where: { meetingId } }),
    ).toBe(4);
  });

  it("is idempotent: a rerun adds nothing and does not call the model", async () => {
    createMock.mockResolvedValue(modelReply(sampleNotes()));

    expect(await writeNotes(meetingId, { resolve: resolve() })).toBe("written");
    expect(await writeNotes(meetingId, { resolve: resolve() })).toBe("ignored");

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(await testPrisma.document.count()).toBe(1);
    expect(await testPrisma.decision.count()).toBe(1);
    expect(await testPrisma.actionItem.count()).toBe(2);
    const meeting = await testPrisma.meeting.findUniqueOrThrow({
      where: { id: meetingId },
    });
    expect(meeting.summaryAttempts).toBe(1);
  });

  it("lets only one of two concurrent runs write", async () => {
    createMock.mockImplementation(async () => {
      await new Promise((resolveTimer) => setTimeout(resolveTimer, 50));
      return modelReply(sampleNotes());
    });

    const outcomes = await Promise.all([
      writeNotes(meetingId, { resolve: resolve() }),
      writeNotes(meetingId, { resolve: resolve() }),
    ]);

    expect(outcomes.filter((o) => o === "written")).toHaveLength(1);
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(await testPrisma.document.count()).toBe(1);
  });

  it("closes a meeting with too few segments without a model call or document", async () => {
    await testPrisma.transcriptSegment.deleteMany({
      where: { meetingId, seq: { gt: 2 } },
    });

    expect(await writeNotes(meetingId, { resolve: resolve() })).toBe(
      "skipped-short",
    );

    expect(createMock).not.toHaveBeenCalled();
    const meeting = await testPrisma.meeting.findUniqueOrThrow({
      where: { id: meetingId },
    });
    expect(meeting.status).toBe("SUMMARIZED");
    expect(meeting.notesDocumentId).toBeNull();
    expect(meeting.summary).toBeNull();
    expect(await testPrisma.document.count()).toBe(0);
  });

  it("closes a meeting with under a minute of speech the same way", async () => {
    await testPrisma.transcriptSegment.deleteMany({ where: { meetingId } });
    await seedTranscript(meetingId, SAMPLE_LINES, { segmentMs: 10_000 });

    expect(await writeNotes(meetingId, { resolve: resolve() })).toBe(
      "skipped-short",
    );
    expect(createMock).not.toHaveBeenCalled();
  });

  it("marks the meeting failed, with a reason, when no model is available", async () => {
    const outcome = await writeNotes(meetingId, {
      resolve: refusingResolver(),
    });

    expect(outcome).toBe("failed");
    const meeting = await testPrisma.meeting.findUniqueOrThrow({
      where: { id: meetingId },
    });
    expect(meeting.status).toBe("FAILED");
    expect(meeting.failureReason).toBe("ai-unavailable: no-key");
    expect(
      await testPrisma.transcriptSegment.count({ where: { meetingId } }),
    ).toBe(4);
  });

  it("marks the meeting failed when the model call itself fails", async () => {
    createMock.mockRejectedValue(new Error("boom"));

    expect(await writeNotes(meetingId, { resolve: resolve() })).toBe("failed");

    const meeting = await testPrisma.meeting.findUniqueOrThrow({
      where: { id: meetingId },
    });
    expect(meeting.status).toBe("FAILED");
    expect(meeting.failureReason).toMatch(/^model-call-failed: /);
  });

  it("ignores a meeting that is still live, a missing one and one that never started", async () => {
    const live = await createMeeting(workspaceId, { status: "LIVE" });
    expect(await writeNotes(live.id, { resolve: resolve() })).toBe("ignored");
    expect(await writeNotes("missing-id", { resolve: resolve() })).toBe(
      "ignored",
    );
    const dispatchFailed = await createMeeting(workspaceId, {
      status: "FAILED",
    });
    await testPrisma.meeting.update({
      where: { id: dispatchFailed.id },
      data: { endReason: "dispatch-failed" },
    });
    expect(await writeNotes(dispatchFailed.id, { resolve: resolve() })).toBe(
      "ignored",
    );
    expect(createMock).not.toHaveBeenCalled();
  });

  it("stops quietly when the meeting is deleted while the model is thinking", async () => {
    createMock.mockImplementation(async () => {
      await testPrisma.meeting.delete({ where: { id: meetingId } });
      return modelReply(sampleNotes());
    });

    expect(await writeNotes(meetingId, { resolve: resolve() })).toBe("ignored");

    expect(await testPrisma.document.count()).toBe(0);
    expect(await testPrisma.decision.count()).toBe(0);
    expect(await testPrisma.actionItem.count()).toBe(0);
  });

  describe("recovery", () => {
    it("retries a failed meeting each sweep and stops at three attempts", async () => {
      createMock.mockResolvedValue(modelReply("not json"));
      const deps = { resolve: resolve() };

      for (let attempt = 1; attempt <= NOTES_MAX_ATTEMPTS; attempt++) {
        expect(await recoverPendingNotes(deps)).toBe(1);
        const meeting = await testPrisma.meeting.findUniqueOrThrow({
          where: { id: meetingId },
        });
        expect(meeting.summaryAttempts).toBe(attempt);
        expect(meeting.status).toBe("FAILED");
      }
      const callsAfterThree = createMock.mock.calls.length;

      expect(await recoverPendingNotes(deps)).toBe(0);
      expect(createMock.mock.calls.length).toBe(callsAfterThree);
      const meeting = await testPrisma.meeting.findUniqueOrThrow({
        where: { id: meetingId },
      });
      expect(meeting.status).toBe("FAILED");
      expect(meeting.failureReason).toMatch(/^invalid-summary/);
      expect(
        await testPrisma.transcriptSegment.count({ where: { meetingId } }),
      ).toBe(4);
    });

    it("finishes a meeting whose first attempt was lost, then leaves it alone", async () => {
      createMock.mockResolvedValue(modelReply(sampleNotes()));

      expect(await recoverPendingNotes({ resolve: resolve() })).toBe(1);
      expect(
        (
          await testPrisma.meeting.findUniqueOrThrow({
            where: { id: meetingId },
          })
        ).status,
      ).toBe("SUMMARIZED");
      expect(await recoverPendingNotes({ resolve: resolve() })).toBe(0);
      expect(await testPrisma.document.count()).toBe(1);
    });

    it("leaves a meeting that ended under a minute ago to its own first attempt", async () => {
      await testPrisma.meeting.update({
        where: { id: meetingId },
        data: { endedAt: new Date(Date.now() - 10_000) },
      });

      expect(await recoverPendingNotes({ resolve: resolve() })).toBe(0);
      expect(createMock).not.toHaveBeenCalled();
    });

    it("skips meetings that are live or whose assistant never started", async () => {
      await createMeeting(workspaceId, { status: "LIVE" });
      const failedStart = await createMeeting(workspaceId, {
        status: "FAILED",
        endedAt: new Date(Date.now() - 10 * 60_000),
      });
      await testPrisma.meeting.update({
        where: { id: failedStart.id },
        data: { endReason: "dispatch-failed" },
      });
      await testPrisma.meeting.update({
        where: { id: meetingId },
        data: { status: "SUMMARIZED" },
      });

      expect(await recoverPendingNotes({ resolve: resolve() })).toBe(0);
    });
  });

  describe("queueing", () => {
    it("runs queued notes after the delay", async () => {
      createMock.mockResolvedValue(modelReply(sampleNotes()));
      scheduleNotes(meetingId, { resolve: resolve(), delayMs: 10 });

      await vi.waitFor(
        async () => {
          const meeting = await testPrisma.meeting.findUniqueOrThrow({
            where: { id: meetingId },
          });
          expect(meeting.status).toBe("SUMMARIZED");
        },
        { timeout: 5_000 },
      );
    });

    it("queues notes when a meeting ends, and none for a meeting that was not live", async () => {
      const live = await createMeeting(workspaceId, { startedById: starterId });

      expect((await endMeeting(live.id, "stopped")).ended).toBe(true);
      expect(clearScheduledNotes()).toBe(1);

      expect((await endMeeting(live.id, "stopped")).ended).toBe(false);
      expect(clearScheduledNotes()).toBe(0);
    });
  });
});
