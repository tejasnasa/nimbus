/**
 * @module api/__tests__/integration/persistence/meetingLifecycle
 * @description How a meeting ends: one conditional transition that several
 * triggers can race to, the free seconds charged from timestamps and capped, the
 * budget backstop, and the boot-time sweep for orphaned meetings.
 *
 * Runs against the real database and Redis, and the dev media server for the
 * room checks.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetLivekitClients } from "../../../lib/livekit/client";
import {
  armBudgetBackstop,
  clearBackstops,
  endLiveMeetingOf,
  endMeeting,
  hasBackstop,
  recoverOrphanedMeetings,
  requestStop,
  stopFlagKey,
  toMeetingDTO,
} from "../../../lib/meeting/lifecycle";
import { pubClient } from "../../../lib/redis";
import {
  closeTestResources,
  createMeeting,
  createUser,
  createWorkspace,
  joinCall,
  leaveAllCalls,
  resetDatabase,
  testPrisma,
} from "@testhelpers";

const saved = process.env.AI_FREE_VOICE_SECONDS;

afterAll(async () => {
  if (saved === undefined) delete process.env.AI_FREE_VOICE_SECONDS;
  else process.env.AI_FREE_VOICE_SECONDS = saved;
  await closeTestResources();
});

/** A broadcaster that records what was sent where. */
function recorder() {
  const sent: Array<{ room: string; event: string; payload: unknown }> = [];
  const io = {
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => {
        sent.push({ room, event, payload });
        return true;
      },
    }),
  } as never;
  return { io, sent };
}

const secondsAgo = (n: number) => new Date(Date.now() - n * 1000);

describe("meeting lifecycle", () => {
  let userId: string;
  let workspaceId: string;

  const used = async () =>
    (await testPrisma.user.findUniqueOrThrow({ where: { id: userId } }))
      .freeVoiceSecondsUsed;

  beforeEach(async () => {
    await resetDatabase();
    process.env.AI_FREE_VOICE_SECONDS = "300";
    userId = (await createUser("Starter")).id;
    workspaceId = (await createWorkspace(userId)).id;
  });

  afterEach(async () => {
    clearBackstops();
    await leaveAllCalls();
    resetLivekitClients();
  });

  describe("endMeeting", () => {
    it("moves a live meeting to ended once, stamping time and reason", async () => {
      const meeting = await createMeeting(workspaceId, { startedById: userId });
      const { io, sent } = recorder();

      const result = await endMeeting(meeting.id, "stopped", { io });

      expect(result).toEqual({ ended: true });
      const row = await testPrisma.meeting.findUniqueOrThrow({ where: { id: meeting.id } });
      expect(row).toMatchObject({ status: "ENDED", endReason: "stopped" });
      expect(row.endedAt!.getTime()).toBeGreaterThan(Date.now() - 5000);
      expect(row.endedAt!.getTime()).toBeLessThan(Date.now() + 5000);
      expect(sent).toEqual([
        {
          room: workspaceId,
          event: "meeting:ended",
          payload: { meetingId: meeting.id, reason: "stopped" },
        },
      ]);
    });

    it("runs its side effects once when four triggers race", async () => {
      const meeting = await createMeeting(workspaceId, {
        startedById: userId,
        source: "FREE",
        budgetSeconds: 300,
        startedAt: secondsAgo(100),
      });
      await requestStop(meeting.id);
      const { io, sent } = recorder();

      const results = await Promise.all([
        endMeeting(meeting.id, "stopped", { io }),
        endMeeting(meeting.id, "agent-left", { io }),
        endMeeting(meeting.id, "room-finished", { io }),
        endMeeting(meeting.id, "budget", { io }),
      ]);

      expect(results.filter((r) => r.ended)).toHaveLength(1);
      expect(sent).toHaveLength(1);
      // Charged once: about 100 seconds, not 400.
      const charged = await used();
      expect(charged).toBeGreaterThanOrEqual(100);
      expect(charged).toBeLessThanOrEqual(103);
      const row = await testPrisma.meeting.findUniqueOrThrow({ where: { id: meeting.id } });
      expect(["stopped", "agent-left", "room-finished", "budget"]).toContain(row.endReason);
      expect(await pubClient.exists(stopFlagKey(meeting.id))).toBe(0);
    });

    it("does nothing for a meeting that already ended", async () => {
      const meeting = await createMeeting(workspaceId, {
        startedById: userId,
        source: "FREE",
        budgetSeconds: 300,
        status: "ENDED",
        startedAt: secondsAgo(100),
        endedAt: secondsAgo(50),
      });
      const { io, sent } = recorder();

      expect(await endMeeting(meeting.id, "stopped", { io })).toEqual({ ended: false });

      expect(sent).toHaveLength(0);
      expect(await used()).toBe(0);
      expect(await endMeeting("no-such-meeting", "stopped")).toEqual({ ended: false });
    });

    it("never touches a meeting that failed to start", async () => {
      const meeting = await createMeeting(workspaceId, {
        startedById: userId,
        source: "FREE",
        status: "FAILED",
      });

      expect(await endMeeting(meeting.id, "stopped")).toEqual({ ended: false });
      expect(await used()).toBe(0);
    });

    describe("free seconds", () => {
      it("charges the elapsed time, rounded up to a whole second", async () => {
        const meeting = await createMeeting(workspaceId, {
          startedById: userId,
          source: "FREE",
          budgetSeconds: 300,
          startedAt: new Date(Date.now() - 42_300),
        });

        await endMeeting(meeting.id, "stopped");

        const charged = await used();
        expect(charged).toBeGreaterThanOrEqual(43);
        expect(charged).toBeLessThanOrEqual(45);
      });

      it("caps the charge at the budget the agent was given", async () => {
        const meeting = await createMeeting(workspaceId, {
          startedById: userId,
          source: "FREE",
          budgetSeconds: 120,
          startedAt: secondsAgo(1000),
        });

        await endMeeting(meeting.id, "budget");

        expect(await used()).toBe(120);
      });

      it("never lets the counter pass the per-user limit", async () => {
        await testPrisma.user.update({
          where: { id: userId },
          data: { freeVoiceSecondsUsed: 250 },
        });
        const meeting = await createMeeting(workspaceId, {
          startedById: userId,
          source: "FREE",
          budgetSeconds: 200,
          startedAt: secondsAgo(150),
        });

        await endMeeting(meeting.id, "stopped");

        expect(await used()).toBe(300);
      });

      it("never lowers a counter that is already above a reduced limit", async () => {
        await testPrisma.user.update({
          where: { id: userId },
          data: { freeVoiceSecondsUsed: 400 },
        });
        const meeting = await createMeeting(workspaceId, {
          startedById: userId,
          source: "FREE",
          budgetSeconds: 100,
          startedAt: secondsAgo(60),
        });

        await endMeeting(meeting.id, "stopped");

        expect(await used()).toBe(400);
      });

      it("does not charge a workspace-key meeting", async () => {
        const meeting = await createMeeting(workspaceId, {
          startedById: userId,
          source: "BYOK",
          startedAt: secondsAgo(500),
        });

        await endMeeting(meeting.id, "stopped");

        expect(await used()).toBe(0);
      });

      it("charges nobody when the starter has since been deleted", async () => {
        const meeting = await createMeeting(workspaceId, {
          startedById: userId,
          source: "FREE",
          budgetSeconds: 300,
          startedAt: secondsAgo(100),
        });
        await testPrisma.meeting.update({
          where: { id: meeting.id },
          data: { startedById: null },
        });

        await expect(endMeeting(meeting.id, "stopped")).resolves.toEqual({ ended: true });
        expect(await used()).toBe(0);
      });
    });

    it("ends the workspace's live meeting by workspace", async () => {
      const meeting = await createMeeting(workspaceId, { startedById: userId });

      expect(await endLiveMeetingOf(workspaceId, "room-finished")).toEqual({ ended: true });
      expect(await endLiveMeetingOf(workspaceId, "room-finished")).toEqual({ ended: false });
      expect(
        (await testPrisma.meeting.findUniqueOrThrow({ where: { id: meeting.id } })).endReason,
      ).toBe("room-finished");
    });
  });

  describe("budget backstop", () => {
    it("removes the agent and ends the meeting once the budget and its grace have passed", async () => {
      const meeting = await createMeeting(workspaceId, {
        startedById: userId,
        source: "FREE",
        budgetSeconds: 10,
        startedAt: secondsAgo(40),
      });
      const { io, sent } = recorder();

      armBudgetBackstop(meeting, { io });
      expect(hasBackstop(meeting.id)).toBe(true);

      await vi.waitFor(
        async () => {
          const row = await testPrisma.meeting.findUniqueOrThrow({ where: { id: meeting.id } });
          expect(row.status).toBe("ENDED");
        },
        { timeout: 5000 },
      );
      expect(
        (await testPrisma.meeting.findUniqueOrThrow({ where: { id: meeting.id } })).endReason,
      ).toBe("budget");
      expect(sent.map((s) => s.event)).toEqual(["meeting:ended"]);
      expect(hasBackstop(meeting.id)).toBe(false);
    });

    it("is disarmed when the meeting ends first", async () => {
      const meeting = await createMeeting(workspaceId, {
        startedById: userId,
        source: "FREE",
        budgetSeconds: 600,
      });
      armBudgetBackstop(meeting);

      await endMeeting(meeting.id, "stopped");

      expect(hasBackstop(meeting.id)).toBe(false);
    });

    it("is not armed for a workspace-key meeting, or one without a budget", async () => {
      const byok = await createMeeting(workspaceId, { startedById: userId, source: "BYOK" });
      const noBudget = await createMeeting(workspaceId, {
        startedById: userId,
        source: "FREE",
        status: "ENDED",
      });

      armBudgetBackstop(byok);
      armBudgetBackstop(noBudget);

      expect(hasBackstop(byok.id)).toBe(false);
      expect(hasBackstop(noBudget.id)).toBe(false);
    });

    it("re-arming replaces the earlier timer", async () => {
      const meeting = await createMeeting(workspaceId, {
        startedById: userId,
        source: "FREE",
        budgetSeconds: 600,
      });

      armBudgetBackstop(meeting);
      armBudgetBackstop(meeting);

      expect(hasBackstop(meeting.id)).toBe(true);
      clearBackstops();
      expect(hasBackstop(meeting.id)).toBe(false);
    });
  });

  describe("boot recovery", () => {
    it("ends live meetings whose room no longer exists", async () => {
      const orphan = await createMeeting(workspaceId, { startedById: userId });
      const otherWorkspace = (await createWorkspace(userId, "Other")).id;
      const another = await createMeeting(otherWorkspace, { startedById: userId });
      const { io, sent } = recorder();

      const ended = await recoverOrphanedMeetings({ io });

      expect(ended).toBe(2);
      for (const id of [orphan.id, another.id]) {
        const row = await testPrisma.meeting.findUniqueOrThrow({ where: { id } });
        expect(row).toMatchObject({ status: "ENDED", endReason: "orphaned" });
      }
      expect(sent.map((s) => s.event)).toEqual(["meeting:ended", "meeting:ended"]);
    });

    it("leaves a meeting alone while its room still exists, and re-arms a free budget", async () => {
      await joinCall({ id: userId, name: "Starter" }, workspaceId);
      const meeting = await createMeeting(workspaceId, {
        startedById: userId,
        source: "FREE",
        budgetSeconds: 600,
      });

      const ended = await recoverOrphanedMeetings();

      expect(ended).toBe(0);
      expect(
        (await testPrisma.meeting.findUniqueOrThrow({ where: { id: meeting.id } })).status,
      ).toBe("LIVE");
      expect(hasBackstop(meeting.id)).toBe(true);
    });

    it("does nothing, and says nothing, when there are no live meetings", async () => {
      await createMeeting(workspaceId, { status: "ENDED" });

      expect(await recoverOrphanedMeetings()).toBe(0);
    });

    it("ends nothing when the media server cannot be asked", async () => {
      const meeting = await createMeeting(workspaceId, { startedById: userId });
      const original = process.env.LIVEKIT_URL;
      process.env.LIVEKIT_URL = "ws://127.0.0.1:1";
      resetLivekitClients();
      const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

      try {
        expect(await recoverOrphanedMeetings()).toBe(0);
      } finally {
        process.env.LIVEKIT_URL = original;
        errorLog.mockRestore();
      }

      expect(
        (await testPrisma.meeting.findUniqueOrThrow({ where: { id: meeting.id } })).status,
      ).toBe("LIVE");
    });
  });

  describe("toMeetingDTO", () => {
    it("serialises times as ISO strings and keeps the reason", async () => {
      const meeting = await createMeeting(workspaceId, {
        startedById: userId,
        status: "ENDED",
        endedAt: new Date("2026-01-01T00:10:00.000Z"),
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
      });
      const row = await testPrisma.meeting.update({
        where: { id: meeting.id },
        data: { endReason: "stopped" },
      });

      expect(toMeetingDTO(row)).toEqual({
        id: meeting.id,
        workspaceId,
        status: "ENDED",
        source: "BYOK",
        startedById: userId,
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: "2026-01-01T00:10:00.000Z",
        endReason: "stopped",
        budgetSeconds: null,
        lastSeq: 0,
      });
    });
  });
});
