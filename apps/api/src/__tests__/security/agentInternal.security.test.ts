/**
 * @module api/__tests__/security/agentInternal
 * @description The properties that keep the one route returning a plaintext
 * provider key safe: it is never logged, never cached, never stored, never
 * reachable through the user-facing API, and a ticket, a session token and a
 * user's cookie are not interchangeable.
 */
import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../app";
import { issueTicket } from "../../lib/meeting/tickets";
import { pubClient } from "../../lib/redis";
import {
  TEST_AI_KEY,
  addMember,
  as,
  closeTestResources,
  createMeeting,
  createUser,
  createWorkspace,
  createWorkspaceAiCredential,
  mintUser,
  resetDatabase,
  testPrisma,
} from "@testhelpers";

const app = createApp();
const bearer = { Authorization: `Bearer ${process.env.NIMBUS_AGENT_SECRET}` };

afterAll(closeTestResources);

describe("security: agent internal API", () => {
  let ownerId: string;
  let workspaceId: string;
  let meetingId: string;

  const redeem = async (id = meetingId) => {
    const ticket = await issueTicket(id);
    const res = await request(app).post("/internal/agent/redeem").set(bearer).send({ ticket });
    return { ticket, res, session: res.body.responseObject?.sessionToken as string };
  };

  beforeEach(async () => {
    await resetDatabase();
    ownerId = (await createUser("Owner")).id;
    workspaceId = (await createWorkspace(ownerId)).id;
    await createWorkspaceAiCredential(workspaceId, "openai", {
      verifiedKinds: ["text", "transcription"],
    });
    meetingId = (await createMeeting(workspaceId, { startedById: ownerId })).id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("never logs the redeem exchange, the key or the session token", async () => {
    const written: string[] = [];
    const capture = (chunk: unknown) => {
      written.push(String(chunk));
      return true;
    };
    vi.spyOn(process.stdout, "write").mockImplementation(capture as never);
    vi.spyOn(process.stderr, "write").mockImplementation(capture as never);
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        written.push(args.map(String).join(" "));
      });
    }

    const { res, session } = await redeem();
    await request(app).post("/internal/agent/redeem").set(bearer).send({ ticket: "z".repeat(43) });
    await request(app)
      .post("/internal/agent/segments")
      .set(bearer)
      .set("X-Meeting-Session", session)
      .send({ segments: [] });
    vi.restoreAllMocks();

    expect(res.status).toBe(200);
    const log = written.join("\n");
    expect(log).not.toContain(TEST_AI_KEY);
    expect(log).not.toContain(session);
    expect(log).not.toContain(process.env.NIMBUS_AGENT_SECRET!);
    // Not even the request line: the internal router is skipped by the access log.
    expect(log).not.toContain("/internal/agent");
  });

  it("marks every internal response uncacheable, failures included", async () => {
    const ok = await redeem();
    const denied = await request(app).post("/internal/agent/redeem").send({});
    const noSession = await request(app).post("/internal/agent/segments").set(bearer).send({});

    for (const res of [ok.res, denied, noSession]) {
      expect(res.headers["cache-control"]).toBe("no-store");
    }
  });

  it("never writes the plaintext key into Redis", async () => {
    await redeem();

    const keys = await pubClient.keys("*");
    for (const key of keys) {
      const type = await pubClient.type(key);
      const value =
        type === "string"
          ? await pubClient.get(key)
          : JSON.stringify(await pubClient.hgetall(key));
      expect(key).not.toContain(TEST_AI_KEY);
      expect(value ?? "").not.toContain(TEST_AI_KEY);
    }
  });

  it("is not reachable through the user-facing API", async () => {
    const { ticket } = { ticket: await issueTicket(meetingId) };

    const withSecret = await request(app)
      .post("/api/internal/agent/redeem")
      .set(bearer)
      .send({ ticket });
    const anonymous = await request(app).post("/api/internal/agent/redeem").send({ ticket });
    const signedIn = await mintUser(app);
    const withCookie = await as(app, signedIn)
      .post("/api/internal/agent/redeem")
      .send({ ticket });

    for (const res of [withSecret, anonymous, withCookie]) {
      expect(res.status).toBeGreaterThanOrEqual(401);
      expect(res.status).toBeLessThanOrEqual(404);
      expect(JSON.stringify(res.body)).not.toContain(TEST_AI_KEY);
    }
    // The ticket was not consumed by any of them.
    expect(await pubClient.get(`ticket:${ticket}`)).toBe(meetingId);
  });

  it("does not let a signed-in user's cookie stand in for the secret", async () => {
    const member = await mintUser(app);
    await addMember(workspaceId, member.id, "ADMIN");
    const ticket = await issueTicket(meetingId);

    const res = await as(app, member).post("/internal/agent/redeem").send({ ticket });

    expect(res.status).toBe(401);
    expect(await pubClient.get(`ticket:${ticket}`)).toBe(meetingId);
  });

  it("does not accept a ticket as a session token", async () => {
    const ticket = await issueTicket(meetingId);

    const res = await request(app)
      .post("/internal/agent/segments")
      .set(bearer)
      .set("X-Meeting-Session", ticket)
      .send({ segments: [{ seq: 1, speakerUserId: null, speakerName: "A", text: "hi", startMs: 0, endMs: 1 }] });

    expect(res.status).toBe(401);
    expect(await testPrisma.transcriptSegment.count()).toBe(0);
  });

  it("does not accept a session token as a ticket", async () => {
    const { session } = await redeem();

    const res = await request(app)
      .post("/internal/agent/redeem")
      .set(bearer)
      .send({ ticket: session });

    expect(res.status).toBe(401);
  });

  it("keeps a session confined to its own meeting", async () => {
    const otherWorkspace = (await createWorkspace(ownerId, "Other")).id;
    await createWorkspaceAiCredential(otherWorkspace, "openai", {
      verifiedKinds: ["text", "transcription"],
    });
    const otherMeeting = (await createMeeting(otherWorkspace, { startedById: ownerId })).id;
    const { session } = await redeem(meetingId);

    // Whatever the body says, the session decides where the data lands.
    const res = await request(app)
      .post("/internal/agent/segments")
      .set(bearer)
      .set("X-Meeting-Session", session)
      .send({
        meetingId: otherMeeting,
        segments: [{ seq: 1, speakerUserId: null, speakerName: "A", text: "hi", startMs: 0, endMs: 1 }],
      });

    expect(res.status).toBe(200);
    expect(await testPrisma.transcriptSegment.count({ where: { meetingId } })).toBe(1);
    expect(await testPrisma.transcriptSegment.count({ where: { meetingId: otherMeeting } })).toBe(0);
  });

  it("refuses a session token that was never issued or has expired", async () => {
    const { session } = await redeem();
    await pubClient.del(`agent-session:${session}`);

    for (const token of [session, "never-issued", "x".repeat(500)]) {
      const res = await request(app)
        .post("/internal/agent/state")
        .set(bearer)
        .set("X-Meeting-Session", token)
        .send({ state: "listening" });
      expect(res.status).toBe(401);
    }
  });

  it("answers every authentication failure with the same body", async () => {
    const { session } = await redeem();

    const bodies = await Promise.all([
      request(app).post("/internal/agent/state").send({}),
      request(app)
        .post("/internal/agent/state")
        .set("Authorization", "Bearer wrong-wrong-wrong-wrong-wrong-wrong-wrong")
        .set("X-Meeting-Session", session)
        .send({}),
      request(app).post("/internal/agent/state").set(bearer).send({}),
      request(app).post("/internal/agent/state").set(bearer).set("X-Meeting-Session", "nope").send({}),
    ]);

    for (const res of bodies) expect(res.status).toBe(401);
    expect(new Set(bodies.map((r) => JSON.stringify(r.body))).size).toBe(1);
  });

  it("rejects an authorization header that is not a bearer token", async () => {
    const secret = process.env.NIMBUS_AGENT_SECRET!;

    for (const header of [secret, `Basic ${secret}`, `bearer ${secret}`, `Bearer  ${secret}`]) {
      const res = await request(app)
        .post("/internal/agent/redeem")
        .set("Authorization", header)
        .send({ ticket: "t".repeat(43) });
      expect(res.status).toBe(401);
    }
  });
});
