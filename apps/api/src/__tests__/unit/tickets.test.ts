/**
 * @module api/__tests__/unit/tickets
 * @description Meeting tickets: random, short-lived and good for one redemption.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createAgentSession, readAgentSession } from "../../lib/meeting/agentSession";
import {
  TICKET_TTL_SECONDS,
  issueTicket,
  redeemTicket,
} from "../../lib/meeting/tickets";
import { pubClient } from "../../lib/redis";
import {
  closeTestResources,
  createMeeting,
  createUser,
  createWorkspace,
  createWorkspaceAiCredential,
  resetDatabase,
} from "@testhelpers";

afterAll(closeTestResources);

describe("tickets", () => {
  beforeEach(resetDatabase);

  it("issues 32 random bytes as 43 base64url characters", async () => {
    const tickets = await Promise.all(
      Array.from({ length: 20 }, (_, i) => issueTicket(`meeting-${i}`)),
    );

    for (const ticket of tickets) {
      expect(ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
    expect(new Set(tickets).size).toBe(20);
  });

  it("stores the meeting id under the ticket with a 60 second life", async () => {
    const ticket = await issueTicket("meeting-1");

    expect(await pubClient.get(`ticket:${ticket}`)).toBe("meeting-1");
    const ttl = await pubClient.ttl(`ticket:${ticket}`);
    expect(ttl).toBeGreaterThan(TICKET_TTL_SECONDS - 5);
    expect(ttl).toBeLessThanOrEqual(TICKET_TTL_SECONDS);
    expect(TICKET_TTL_SECONDS).toBe(60);
  });

  it("is spent by the first redemption, whether or not it succeeds", async () => {
    const ticket = await issueTicket("meeting-that-does-not-exist");

    expect(await redeemTicket(ticket)).toEqual({ ok: false });
    expect(await pubClient.exists(`ticket:${ticket}`)).toBe(0);
  });

  it("can be redeemed once and only once", async () => {
    const user = await createUser("Starter");
    const workspace = await createWorkspace(user.id);
    await createWorkspaceAiCredential(workspace.id, "openai", {
      verifiedKinds: ["text", "transcription"],
    });
    const meeting = await createMeeting(workspace.id, { startedById: user.id });
    const ticket = await issueTicket(meeting.id);

    const [first, second] = [await redeemTicket(ticket), await redeemTicket(ticket)];

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
  });

  it("refuses a meeting nobody started", async () => {
    const user = await createUser("Starter");
    const workspace = await createWorkspace(user.id);
    const meeting = await createMeeting(workspace.id, { startedById: null });

    expect(await redeemTicket(await issueTicket(meeting.id))).toEqual({ ok: false });
  });
});

describe("agent sessions", () => {
  it("round-trips a session and rejects what it did not issue", async () => {
    const token = await createAgentSession({ meetingId: "m1", providerId: "openai" });

    expect(await readAgentSession(token)).toEqual({
      meetingId: "m1",
      providerId: "openai",
      credentialId: undefined,
    });
    expect(await readAgentSession(undefined)).toBeNull();
    expect(await readAgentSession("")).toBeNull();
    expect(await readAgentSession("unknown")).toBeNull();
    expect(await readAgentSession("x".repeat(200))).toBeNull();
  });

  it("lives for six hours", async () => {
    const token = await createAgentSession({ meetingId: "m1", providerId: "openai" });

    const ttl = await pubClient.ttl(`agent-session:${token}`);

    expect(ttl).toBeGreaterThan(21_000);
    expect(ttl).toBeLessThanOrEqual(21_600);
  });

  it("treats a corrupt record as no session", async () => {
    await pubClient.set("agent-session:corrupt", "{not json");
    await pubClient.set("agent-session:shapeless", JSON.stringify({ nope: 1 }));

    expect(await readAgentSession("corrupt")).toBeNull();
    expect(await readAgentSession("shapeless")).toBeNull();
  });
});
