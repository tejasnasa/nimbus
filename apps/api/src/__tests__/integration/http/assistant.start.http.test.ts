/**
 * @module api/__tests__/integration/http/assistant.start.http
 * @description Starting and stopping the in-call assistant over HTTP: who may,
 * what refuses, the one-live-meeting guarantee under a race, and what the agent
 * dispatch carries.
 *
 * A real participant sits in a real room on the dev media server, so "someone
 * is on the call" is the media server's answer. Only the dispatch itself is
 * stubbed, because no agent worker runs here.
 */
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createApp } from "../../../app";
import { getAgentDispatchClient } from "../../../lib/livekit/client";
import { clearBackstops, hasBackstop } from "../../../lib/meeting/lifecycle";
import { TICKET_TTL_SECONDS } from "../../../lib/meeting/tickets";
import { pubClient } from "../../../lib/redis";
import {
  addMember,
  as,
  closeTestResources,
  createMeeting,
  createWorkspace,
  createWorkspaceAiCredential,
  joinCall,
  leaveAllCalls,
  mintUser,
  resetDatabase,
  testPrisma,
  type TestUser,
} from "@testhelpers";

const app = createApp();

const ENV_KEYS = ["AI_VOICE_API_KEY", "AI_FREE_VOICE_SECONDS"] as const;
const saved: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) saved[key] = process.env[key];

afterAll(async () => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  await closeTestResources();
});

describe("http: assistant start and stop", () => {
  let owner: TestUser;
  let member: TestUser;
  let outsider: TestUser;
  let workspaceId: string;
  let dispatch: ReturnType<typeof vi.spyOn>;

  const start = (user: TestUser, body: unknown = { workspaceId }) =>
    as(app, user).post("/api/meetings/assistant/start").send(body as object);

  /** Gives the workspace its own verified transcription key. */
  const addWorkspaceKey = () =>
    createWorkspaceAiCredential(workspaceId, "openai", {
      verifiedKinds: ["text", "transcription"],
    });

  const liveMeetings = () =>
    testPrisma.meeting.findMany({ where: { workspaceId, status: "LIVE" } });

  beforeEach(async () => {
    await resetDatabase();
    for (const key of ENV_KEYS) delete process.env[key];
    owner = await mintUser(app, { name: "Olive Owner" });
    member = await mintUser(app, { name: "Mia Member" });
    outsider = await mintUser(app, { name: "Otto Outsider" });
    workspaceId = (await createWorkspace(owner.id)).id;
    await addMember(workspaceId, member.id, "MEMBER");
    dispatch = vi
      .spyOn(getAgentDispatchClient(), "createDispatch")
      .mockResolvedValue({} as never);
  });

  afterEach(async () => {
    dispatch.mockRestore();
    clearBackstops();
    await leaveAllCalls();
  });

  it("answers a non-member with 404 and creates nothing", async () => {
    await joinCall(owner, workspaceId);
    await addWorkspaceKey();

    const res = await start(outsider);

    expect(res.status).toBe(404);
    expect(await testPrisma.meeting.count()).toBe(0);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("requires a signed-in user", async () => {
    const res = await as(app, { cookie: "" } as TestUser)
      .post("/api/meetings/assistant/start")
      .send({ workspaceId });

    expect(res.status).toBe(401);
  });

  it("rejects a body without a workspace id", async () => {
    const res = await start(member, {});

    expect(res.status).toBe(400);
  });

  it("refuses with 409 when no one is on the call", async () => {
    await addWorkspaceKey();

    const res = await start(member);

    expect(res.status).toBe(409);
    expect(await testPrisma.meeting.count()).toBe(0);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("does not count another agent as a person on the call", async () => {
    await addWorkspaceKey();
    await joinCall({ id: "agent-impostor", name: "Impostor" }, workspaceId);

    const res = await start(member);

    expect(res.status).toBe(409);
  });

  describe("refusals", () => {
    beforeEach(async () => {
      await joinCall(owner, workspaceId);
    });

    it("tells a workspace with no voice key, and no free tier, to add one", async () => {
      const res = await start(member);

      expect(res.status).toBe(403);
      expect(res.body.responseObject).toEqual({
        reason: "no-voice-key",
        cta: "add-key",
      });
      expect(res.body.message).toMatch(/transcription key/i);
      expect(await testPrisma.meeting.count()).toBe(0);
    });

    it("refuses when an admin switched the assistant off", async () => {
      await addWorkspaceKey();
      await testPrisma.workspaceAiSettings.create({
        data: { workspaceId, assistantEnabled: false },
      });

      const res = await start(member);

      expect(res.status).toBe(403);
      expect(res.body.responseObject).toEqual({
        reason: "assistant-disabled",
        cta: "manage-ai",
      });
    });

    it("refuses when the monthly spend cap is reached", async () => {
      await addWorkspaceKey();
      await testPrisma.workspaceAiSettings.create({
        data: { workspaceId, monthlySpendCapUsd: "1.00" },
      });
      await testPrisma.aiCall.create({
        data: {
          workspaceId,
          feature: "CHAT",
          providerId: "openai",
          modelId: "gpt-5",
          source: "BYOK",
          status: "OK",
          latencyMs: 1,
          costUsd: "5.00",
        },
      });

      const res = await start(member);

      expect(res.status).toBe(403);
      expect(res.body.responseObject.reason).toBe("spend-cap-reached");
    });

    it("refuses a free-tier user with under 15 seconds left", async () => {
      process.env.AI_VOICE_API_KEY = "operator-voice-key";
      process.env.AI_FREE_VOICE_SECONDS = "300";
      await testPrisma.user.update({
        where: { id: member.id },
        data: { freeVoiceSecondsUsed: 290 },
      });

      const res = await start(member);

      expect(res.status).toBe(403);
      expect(res.body.responseObject).toEqual({
        reason: "free-voice-exhausted",
        cta: "add-key",
      });
    });
  });

  describe("starting", () => {
    beforeEach(async () => {
      await joinCall(owner, workspaceId);
    });

    it("creates a live meeting on the workspace key and dispatches the agent", async () => {
      await addWorkspaceKey();

      const res = await start(member);

      expect(res.status).toBe(201);
      const meeting = res.body.responseObject;
      expect(meeting).toMatchObject({
        workspaceId,
        status: "LIVE",
        source: "BYOK",
        startedById: member.id,
        budgetSeconds: null,
        lastSeq: 0,
      });

      const row = await testPrisma.meeting.findUniqueOrThrow({
        where: { id: meeting.id },
      });
      expect(row.roomName).toBe(`nimbus-ws-${workspaceId}`);
      expect(row.status).toBe("LIVE");
      // A workspace key arms no budget backstop.
      expect(hasBackstop(meeting.id)).toBe(false);
    });

    it("dispatches by name with a ticket and nothing else in the metadata", async () => {
      await addWorkspaceKey();

      const res = await start(member);
      const meetingId = res.body.responseObject.id as string;

      expect(dispatch).toHaveBeenCalledOnce();
      const [room, agentName, options] = dispatch.mock.calls[0] as [
        string,
        string,
        { metadata: string },
      ];
      expect(room).toBe(`nimbus-ws-${workspaceId}`);
      expect(agentName).toBe("nimbus");
      const metadata = JSON.parse(options.metadata) as Record<string, unknown>;
      expect(Object.keys(metadata)).toEqual(["ticket"]);

      const ticket = metadata.ticket as string;
      expect(ticket).toHaveLength(43);
      expect(await pubClient.get(`ticket:${ticket}`)).toBe(meetingId);
      const ttl = await pubClient.ttl(`ticket:${ticket}`);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(TICKET_TTL_SECONDS);
      // No key, secret or provider detail rides along.
      expect(options.metadata).not.toMatch(/key|secret|sk-/i);
    });

    it("hands a free-tier user's remaining seconds to the agent as the budget", async () => {
      process.env.AI_VOICE_API_KEY = "operator-voice-key";
      process.env.AI_FREE_VOICE_SECONDS = "300";
      await testPrisma.user.update({
        where: { id: member.id },
        data: { freeVoiceSecondsUsed: 100 },
      });

      const res = await start(member);

      expect(res.status).toBe(201);
      expect(res.body.responseObject).toMatchObject({
        source: "FREE",
        budgetSeconds: 200,
      });
      expect(hasBackstop(res.body.responseObject.id)).toBe(true);
    });

    it("returns the running meeting when started again, without a second dispatch", async () => {
      await addWorkspaceKey();

      const first = await start(member);
      const second = await start(owner);

      expect(first.status).toBe(201);
      expect(second.status).toBe(200);
      expect(second.body.responseObject.id).toBe(first.body.responseObject.id);
      expect(dispatch).toHaveBeenCalledOnce();
      expect(await liveMeetings()).toHaveLength(1);
    });

    it("lets exactly one of five simultaneous starts create the meeting", async () => {
      await addWorkspaceKey();

      const results = await Promise.all(
        [member, owner, member, owner, member].map((user) => start(user)),
      );

      expect(results.every((r) => r.status === 200 || r.status === 201)).toBe(true);
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(await liveMeetings()).toHaveLength(1);
      expect(await testPrisma.meeting.count()).toBe(1);
      expect(new Set(results.map((r) => r.body.responseObject.id)).size).toBe(1);
      expect(dispatch).toHaveBeenCalledOnce();
    });

    it("marks the meeting failed and answers 502 when the dispatch fails", async () => {
      await addWorkspaceKey();
      dispatch.mockRejectedValueOnce(new Error("media server down"));
      const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

      const res = await start(member);
      errorLog.mockRestore();

      expect(res.status).toBe(502);
      expect(res.body.message).toBe("Nimbus couldn't join the call. Please try again.");
      expect(JSON.stringify(res.body)).not.toContain("media server down");
      const rows = await testPrisma.meeting.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: "FAILED", endReason: "dispatch-failed" });
      expect(rows[0]!.endedAt).not.toBeNull();

      // The failure does not block the next try.
      const retry = await start(member);
      expect(retry.status).toBe(201);
    });

    it("answers 502 when the media server cannot be asked who is on the call", async () => {
      await addWorkspaceKey();
      const original = process.env.LIVEKIT_URL;
      process.env.LIVEKIT_URL = "ws://127.0.0.1:1";
      const { resetLivekitClients } = await import("../../../lib/livekit/client");
      resetLivekitClients();
      const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

      try {
        const res = await start(member);
        expect(res.status).toBe(502);
      } finally {
        process.env.LIVEKIT_URL = original;
        resetLivekitClients();
        errorLog.mockRestore();
      }
    });
  });

  describe("stopping", () => {
    it("ends the meeting for a member and sets the stop flag", async () => {
      const meeting = await createMeeting(workspaceId, { startedById: owner.id });

      const res = await as(app, member).post(
        `/api/meetings/${meeting.id}/assistant/stop`,
      );

      expect(res.status).toBe(200);
      expect(res.body.responseObject).toMatchObject({ id: meeting.id, status: "ENDED", endReason: "stopped" });
      const row = await testPrisma.meeting.findUniqueOrThrow({ where: { id: meeting.id } });
      expect(row.status).toBe("ENDED");
      expect(row.endedAt).not.toBeNull();
    });

    it("is idempotent for a meeting that already ended", async () => {
      const meeting = await createMeeting(workspaceId, {
        status: "ENDED",
        endedAt: new Date(),
      });

      const res = await as(app, member).post(
        `/api/meetings/${meeting.id}/assistant/stop`,
      );

      expect(res.status).toBe(200);
      expect(res.body.responseObject.status).toBe("ENDED");
    });

    it("answers a non-member, and an unknown meeting, with 404", async () => {
      const meeting = await createMeeting(workspaceId);

      const foreign = await as(app, outsider).post(
        `/api/meetings/${meeting.id}/assistant/stop`,
      );
      const unknown = await as(app, member).post(
        "/api/meetings/does-not-exist/assistant/stop",
      );

      expect(foreign.status).toBe(404);
      expect(unknown.status).toBe(404);
      expect(
        (await testPrisma.meeting.findUniqueOrThrow({ where: { id: meeting.id } })).status,
      ).toBe("LIVE");
    });
  });

  describe("reading", () => {
    it("reports the live meeting, or none, to a member only", async () => {
      const none = await as(app, member).get(`/api/meetings/live?workspaceId=${workspaceId}`);
      expect(none.status).toBe(200);
      expect(none.body.responseObject).toEqual({ meeting: null });

      const meeting = await createMeeting(workspaceId, { startedById: owner.id });
      const live = await as(app, member).get(`/api/meetings/live?workspaceId=${workspaceId}`);
      expect(live.body.responseObject.meeting).toMatchObject({ id: meeting.id, status: "LIVE" });

      const foreign = await as(app, outsider).get(`/api/meetings/live?workspaceId=${workspaceId}`);
      expect(foreign.status).toBe(404);

      const bad = await as(app, member).get("/api/meetings/live");
      expect(bad.status).toBe(400);
    });

    it("pages the transcript after a sequence number, members only", async () => {
      const meeting = await createMeeting(workspaceId);
      await testPrisma.transcriptSegment.createMany({
        data: [1, 2, 3, 4, 5].map((seq) => ({
          meetingId: meeting.id,
          seq,
          speakerName: "Ada",
          text: `line ${seq}`,
          startMs: seq * 1000,
          endMs: seq * 1000 + 500,
        })),
      });

      const first = await as(app, member).get(`/api/meetings/${meeting.id}/segments?limit=2`);
      expect(first.body.responseObject.segments.map((s: { seq: number }) => s.seq)).toEqual([1, 2]);
      expect(first.body.responseObject.hasMore).toBe(true);

      const rest = await as(app, member).get(`/api/meetings/${meeting.id}/segments?afterSeq=2`);
      expect(rest.body.responseObject.segments.map((s: { seq: number }) => s.seq)).toEqual([3, 4, 5]);
      expect(rest.body.responseObject.hasMore).toBe(false);

      const foreign = await as(app, outsider).get(`/api/meetings/${meeting.id}/segments`);
      expect(foreign.status).toBe(404);
      const unknown = await as(app, member).get("/api/meetings/nope/segments");
      expect(unknown.status).toBe(404);
      const bad = await as(app, member).get(`/api/meetings/${meeting.id}/segments?limit=9999`);
      expect(bad.status).toBe(400);
    });
  });
});
