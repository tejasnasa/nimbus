/**
 * @module api/__tests__/integration/http/agentInternal
 * @description The voice agent's private API over HTTP: ticket redemption and
 * its single-use rule, the transcript routes and their idempotency, usage
 * landing in the workspace call log, and the stop signal reaching the agent.
 *
 * The agent is played by supertest: it presents the shared secret, redeems a
 * ticket for a session token, and then calls the session routes as the real
 * worker would.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../app";
import { spendCacheKey } from "../../../lib/ai/spendCap";
import { requestStop } from "../../../lib/meeting/lifecycle";
import { issueTicket } from "../../../lib/meeting/tickets";
import { pubClient } from "../../../lib/redis";
import request from "supertest";
import {
  TEST_AI_KEY,
  addMember,
  closeTestResources,
  createMeeting,
  createUser,
  createWorkspace,
  createWorkspaceAiCredential,
  resetDatabase,
  testPrisma,
} from "@testhelpers";

const app = createApp();
const SECRET = process.env.NIMBUS_AGENT_SECRET!;
const bearer = { Authorization: `Bearer ${SECRET}` };

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

const segment = (seq: number, overrides: Record<string, unknown> = {}) => ({
  seq,
  speakerUserId: null,
  speakerName: "Ada",
  text: `line ${seq}`,
  startMs: seq * 1000,
  endMs: seq * 1000 + 800,
  ...overrides,
});

describe("http: agent internal API", () => {
  let ownerId: string;
  let memberId: string;
  let workspaceId: string;
  let meetingId: string;

  /** Issues a ticket and redeems it, as the dispatched agent would. */
  const redeem = async (id = meetingId) => {
    const ticket = await issueTicket(id);
    const res = await request(app)
      .post("/internal/agent/redeem")
      .set(bearer)
      .send({ ticket });
    return { ticket, res, session: res.body.responseObject?.sessionToken as string };
  };

  const agent = (session: string) => ({
    post: (path: string) =>
      request(app)
        .post(`/internal/agent${path}`)
        .set(bearer)
        .set("X-Meeting-Session", session),
  });

  beforeEach(async () => {
    await resetDatabase();
    for (const key of ENV_KEYS) delete process.env[key];
    const owner = await createUser("Olive Owner");
    const member = await createUser("Mia Member");
    ownerId = owner.id;
    memberId = member.id;
    workspaceId = (await createWorkspace(ownerId)).id;
    await addMember(workspaceId, memberId, "MEMBER");
    await createWorkspaceAiCredential(workspaceId, "openai", {
      verifiedKinds: ["text", "transcription"],
    });
    meetingId = (await createMeeting(workspaceId, { startedById: ownerId })).id;
  });

  describe("authentication", () => {
    const routes = ["/redeem", "/segments", "/state", "/usage", "/ended"];

    it.each(routes)("refuses %s without the secret", async (path) => {
      const res = await request(app).post(`/internal/agent${path}`).send({});
      expect(res.status).toBe(401);
    });

    it.each(routes)("refuses %s with the wrong secret", async (path) => {
      const res = await request(app)
        .post(`/internal/agent${path}`)
        .set("Authorization", "Bearer not-the-secret-not-the-secret-not-the-secret")
        .send({});
      expect(res.status).toBe(401);
    });

    it.each(["/segments", "/state", "/usage", "/ended"])(
      "refuses %s with the secret but no session",
      async (path) => {
        const res = await request(app).post(`/internal/agent${path}`).set(bearer).send({});
        expect(res.status).toBe(401);
      },
    );
  });

  describe("redeem", () => {
    it("hands over the session configuration, with the key, once", async () => {
      const { res } = await redeem();

      expect(res.status).toBe(200);
      expect(res.headers["cache-control"]).toBe("no-store");
      const payload = res.body.responseObject;
      expect(payload).toMatchObject({
        meetingId,
        workspaceId,
        roomName: `nimbus-ws-${workspaceId}`,
        budgetSeconds: null,
        wakeNames: ["nimbus", "nimbus bot", "nimbusbot"],
        voice: { apiKey: TEST_AI_KEY, transcribeModel: expect.any(String) },
      });
      expect(payload.voice.baseUrl).toMatch(/^https:\/\/api\.openai\.com/);
      expect(payload.sessionToken).toHaveLength(43);
      expect(new Date(payload.startedAt).getTime()).not.toBeNaN();
      // Members are named for speaker attribution; the bot is not one of them.
      expect(payload.members.map((m: { name: string }) => m.name).sort()).toEqual([
        "Mia Member",
        "Olive Owner",
      ]);
    });

    it("refuses the same ticket a second time", async () => {
      const { ticket, res } = await redeem();
      expect(res.status).toBe(200);

      const again = await request(app)
        .post("/internal/agent/redeem")
        .set(bearer)
        .send({ ticket });

      expect(again.status).toBe(401);
      expect(again.body.responseObject).toBeNull();
    });

    it("lets only one of several simultaneous redemptions win", async () => {
      const ticket = await issueTicket(meetingId);

      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          request(app).post("/internal/agent/redeem").set(bearer).send({ ticket }),
        ),
      );

      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    });

    it("answers an unknown or malformed ticket with the same bare 401", async () => {
      const unknown = await request(app)
        .post("/internal/agent/redeem")
        .set(bearer)
        .send({ ticket: "x".repeat(43) });
      const malformed = await request(app)
        .post("/internal/agent/redeem")
        .set(bearer)
        .send({ ticket: 12 });

      expect(unknown.status).toBe(401);
      expect(malformed.status).toBe(401);
      expect(malformed.body).toEqual(unknown.body);
    });

    it("refuses a ticket for a meeting that is no longer live", async () => {
      await testPrisma.meeting.update({
        where: { id: meetingId },
        data: { status: "ENDED", endedAt: new Date() },
      });

      const { res } = await redeem();

      expect(res.status).toBe(401);
    });

    it("refuses, and ends the meeting, when the key was removed after the ticket was issued", async () => {
      const ticket = await issueTicket(meetingId);
      await testPrisma.workspaceAiCredential.deleteMany({ where: { workspaceId } });

      const res = await request(app)
        .post("/internal/agent/redeem")
        .set(bearer)
        .send({ ticket });

      expect(res.status).toBe(401);
      expect(JSON.stringify(res.body)).not.toContain(TEST_AI_KEY);
      const row = await testPrisma.meeting.findUniqueOrThrow({ where: { id: meetingId } });
      expect(row).toMatchObject({ status: "ENDED", endReason: "invalid-key" });
    });

    it("gives a free-tier session the operator's key and the meeting's budget", async () => {
      await testPrisma.workspaceAiCredential.deleteMany({ where: { workspaceId } });
      process.env.AI_VOICE_API_KEY = "operator-voice-key";
      const free = await createMeeting(workspaceId, {
        startedById: ownerId,
        source: "FREE",
        budgetSeconds: 240,
        status: "ENDED",
      });
      await testPrisma.meeting.update({
        where: { id: meetingId },
        data: { status: "ENDED", endedAt: new Date() },
      });
      await testPrisma.meeting.update({ where: { id: free.id }, data: { status: "LIVE" } });

      const { res } = await redeem(free.id);

      expect(res.status).toBe(200);
      expect(res.body.responseObject.budgetSeconds).toBe(240);
      expect(res.body.responseObject.voice.apiKey).toBe("operator-voice-key");
      expect(res.body.responseObject.voice.baseUrl).toBe("https://openrouter.ai/api/v1");
    });

    it("allows ten attempts a minute per address and then refuses even a good ticket", async () => {
      for (let i = 0; i < 10; i++) {
        await request(app)
          .post("/internal/agent/redeem")
          .set(bearer)
          .send({ ticket: "y".repeat(43) });
      }

      const { res } = await redeem();

      expect(res.status).toBe(401);
    });
  });

  describe("segments", () => {
    it("stores a batch and confirms every sequence number", async () => {
      const { session } = await redeem();

      const res = await agent(session)
        .post("/segments")
        .send({
          segments: [
            segment(1, { speakerUserId: memberId, speakerName: "Mia" }),
            segment(2),
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.responseObject).toEqual({ accepted: [1, 2], stop: false });
      const rows = await testPrisma.transcriptSegment.findMany({
        where: { meetingId },
        orderBy: { seq: "asc" },
      });
      expect(rows.map((r) => r.text)).toEqual(["line 1", "line 2"]);
      expect(rows[0]!.speakerUserId).toBe(memberId);
      expect((await testPrisma.meeting.findUniqueOrThrow({ where: { id: meetingId } })).lastSeq).toBe(2);
    });

    it("is idempotent: replaying a batch stores nothing new", async () => {
      const { session } = await redeem();
      const body = { segments: [segment(1), segment(2)] };

      const first = await agent(session).post("/segments").send(body);
      const replay = await agent(session).post("/segments").send(body);

      expect(replay.status).toBe(200);
      expect(replay.body.responseObject.accepted).toEqual(first.body.responseObject.accepted);
      expect(await testPrisma.transcriptSegment.count({ where: { meetingId } })).toBe(2);
    });

    it("keeps lastSeq at the highest number even when batches arrive out of order", async () => {
      const { session } = await redeem();

      await agent(session).post("/segments").send({ segments: [segment(5)] });
      await agent(session).post("/segments").send({ segments: [segment(3)] });

      expect(
        (await testPrisma.meeting.findUniqueOrThrow({ where: { id: meetingId } })).lastSeq,
      ).toBe(5);
    });

    it("stores a speaker who is not a member of the workspace without the id", async () => {
      const stranger = await createUser("Stranger");
      const { session } = await redeem();

      await agent(session)
        .post("/segments")
        .send({ segments: [segment(1, { speakerUserId: stranger.id, speakerName: "Stranger" })] });

      const row = await testPrisma.transcriptSegment.findFirstOrThrow({ where: { meetingId } });
      expect(row.speakerUserId).toBeNull();
      expect(row.speakerName).toBe("Stranger");
    });

    it("rejects malformed batches", async () => {
      const { session } = await redeem();

      for (const body of [
        {},
        { segments: [] },
        { segments: [segment(0)] },
        { segments: [segment(1, { text: "" })] },
        { segments: [{ ...segment(1), startMs: -5 }] },
      ]) {
        const res = await agent(session).post("/segments").send(body);
        expect(res.status).toBe(400);
      }
    });

    it("still accepts the final flush shortly after the meeting ended, and says stop", async () => {
      const { session } = await redeem();
      await testPrisma.meeting.update({
        where: { id: meetingId },
        data: { status: "ENDED", endedAt: new Date() },
      });

      const res = await agent(session).post("/segments").send({ segments: [segment(1)] });

      expect(res.body.responseObject).toEqual({ accepted: [1], stop: true });
      expect(await testPrisma.transcriptSegment.count({ where: { meetingId } })).toBe(1);
    });

    it("refuses segments long after the meeting ended", async () => {
      const { session } = await redeem();
      await testPrisma.meeting.update({
        where: { id: meetingId },
        data: { status: "ENDED", endedAt: new Date(Date.now() - 10 * 60_000) },
      });

      const res = await agent(session).post("/segments").send({ segments: [segment(1)] });

      expect(res.body.responseObject).toEqual({ accepted: [], stop: true });
      expect(await testPrisma.transcriptSegment.count({ where: { meetingId } })).toBe(0);
    });
  });

  describe("stop propagation", () => {
    it("tells the agent to stop once the flag is set", async () => {
      const { session } = await redeem();
      expect(
        (await agent(session).post("/state").send({ state: "listening" })).body.responseObject,
      ).toEqual({ stop: false });

      await requestStop(meetingId);

      const state = await agent(session).post("/state").send({ state: "listening" });
      const segments = await agent(session).post("/segments").send({ segments: [segment(1)] });
      expect(state.body.responseObject.stop).toBe(true);
      expect(segments.body.responseObject.stop).toBe(true);
    });

    it("tells the agent to stop after the stop route ended the meeting", async () => {
      const { session } = await redeem();
      await pubClient.set(`meeting:${meetingId}:stop`, "1");
      await testPrisma.meeting.update({
        where: { id: meetingId },
        data: { status: "ENDED", endedAt: new Date() },
      });

      const state = await agent(session).post("/state").send({ state: "listening" });

      expect(state.body.responseObject).toEqual({ stop: true });
    });

    it("rejects an invalid state", async () => {
      const { session } = await redeem();

      const res = await agent(session).post("/state").send({ state: "dancing" });

      expect(res.status).toBe(400);
    });
  });

  describe("usage", () => {
    const entry = (overrides: Record<string, unknown> = {}) => ({
      feature: "transcription",
      model: "gpt-4o-mini-transcribe",
      audioSeconds: 60,
      latencyMs: 640,
      status: "OK",
      ...overrides,
    });

    it("writes call-log rows for the meeting, the workspace and the starter", async () => {
      const { session } = await redeem();

      const res = await agent(session)
        .post("/usage")
        .send({
          entries: [
            entry(),
            entry({ status: "ERROR", audioSeconds: 0, errorReason: "timeout" }),
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.responseObject).toEqual({ stop: false });
      const rows = await testPrisma.aiCall.findMany({
        where: { meetingId },
        orderBy: { createdAt: "asc" },
      });
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        workspaceId,
        userId: ownerId,
        meetingId,
        feature: "TRANSCRIPTION",
        providerId: "openai",
        modelId: "gpt-4o-mini-transcribe",
        source: "BYOK",
        status: "OK",
        audioSeconds: 60,
        latencyMs: 640,
      });
      expect(Number(rows[0]!.costUsd)).toBeCloseTo(0.0018, 4);
      expect(rows[1]).toMatchObject({ status: "ERROR", errorReason: "timeout", costUsd: null });
    });

    it("records free-tier usage as free, with no workspace credential touched", async () => {
      await testPrisma.workspaceAiCredential.deleteMany({ where: { workspaceId } });
      process.env.AI_VOICE_API_KEY = "operator-voice-key";
      await testPrisma.meeting.update({
        where: { id: meetingId },
        data: { source: "FREE", budgetSeconds: 200 },
      });
      const { session } = await redeem();

      await agent(session)
        .post("/usage")
        .send({ entries: [entry({ model: "openai/gpt-transcribe", audioSeconds: 12 })] });

      const row = await testPrisma.aiCall.findFirstOrThrow({ where: { meetingId } });
      expect(row).toMatchObject({ source: "FREE", providerId: "openrouter", audioSeconds: 12 });
    });

    it("ends the meeting and says stop when the spend cap is reached", async () => {
      await testPrisma.workspaceAiSettings.create({
        data: { workspaceId, monthlySpendCapUsd: "0.01" },
      });
      const { session } = await redeem();

      // The cap reads a sum cached for 30 seconds, and redemption just cached
      // zero; clear it so the usage below is what the check sees.
      await pubClient.del(spendCacheKey(workspaceId, new Date()));
      // Ten minutes at the model's price is well over a cent.
      const res = await agent(session)
        .post("/usage")
        .send({ entries: [entry({ audioSeconds: 600 })] });

      expect(res.body.responseObject).toEqual({ stop: true });
      const row = await testPrisma.meeting.findUniqueOrThrow({ where: { id: meetingId } });
      expect(row).toMatchObject({ status: "ENDED", endReason: "spend-cap" });
    });

    it("rejects malformed usage", async () => {
      const { session } = await redeem();

      for (const body of [{}, { entries: [] }, { entries: [entry({ feature: "chat" })] }]) {
        const res = await agent(session).post("/usage").send(body);
        expect(res.status).toBe(400);
      }
    });
  });

  describe("ended", () => {
    it.each([
      ["budget", "budget"],
      ["invalid-key", "invalid-key"],
      ["agent-ended", "agent-ended"],
      ["shutdown", "agent-ended"],
      ["stopped", "stopped"],
    ])("ends the meeting for the agent's reason %s", async (reason, stored) => {
      const { session } = await redeem();

      const res = await agent(session).post("/ended").send({ reason });

      expect(res.status).toBe(200);
      const row = await testPrisma.meeting.findUniqueOrThrow({ where: { id: meetingId } });
      expect(row).toMatchObject({ status: "ENDED", endReason: stored });
    });

    it("keeps the first reason when called again", async () => {
      const { session } = await redeem();
      await agent(session).post("/ended").send({ reason: "budget" });

      await agent(session).post("/ended").send({ reason: "shutdown" });

      expect(
        (await testPrisma.meeting.findUniqueOrThrow({ where: { id: meetingId } })).endReason,
      ).toBe("budget");
    });

    it("rejects an unknown reason", async () => {
      const { session } = await redeem();

      const res = await agent(session).post("/ended").send({ reason: "bored" });

      expect(res.status).toBe(400);
    });
  });
});
