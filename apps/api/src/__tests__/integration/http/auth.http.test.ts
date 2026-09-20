/**
 * @module api/__tests__/integration/http/auth
 * @description better-auth flows driven through its real mounted endpoints:
 * sign-up, email-verification gating, sign-in, session persistence, sign-out,
 * account deletion (cascade + freshness gate), password reset (with session
 * revocation), and the shape of the session cookie it issues.
 *
 * Sessions are minted through the real flow (see `testhelpers/session.ts`)
 * rather than forged, so the auth configuration under test is the one that runs.
 */
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../app";
import { cascadeOwnedWorkspaces } from "../../../lib/accountDeletion";
import {
  TEST_PASSWORD,
  addMember,
  as,
  closeTestResources,
  createDocument,
  createMessage,
  createUser,
  createWorkspace,
  mintUser,
  resetDatabase,
  testPrisma,
} from "@testhelpers";

const app = createApp();

describe("http: auth", () => {
  beforeEach(resetDatabase);

  it("creates an unverified user on sign-up", async () => {
    const email = "fresh@example.test";

    const res = await request(app)
      .post("/api/auth/sign-up/email")
      .send({ email, password: TEST_PASSWORD, name: "Fresh User" });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email, emailVerified: false });

    const stored = await testPrisma.user.findUnique({ where: { email } });
    expect(stored).not.toBeNull();
    expect(stored?.emailVerified).toBe(false);
  });

  it("blocks sign-in until the email is verified", async () => {
    const email = "unverified@example.test";
    await request(app)
      .post("/api/auth/sign-up/email")
      .send({ email, password: TEST_PASSWORD, name: "Unverified" });

    const res = await request(app)
      .post("/api/auth/sign-in/email")
      .send({ email, password: TEST_PASSWORD });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: "EMAIL_NOT_VERIFIED" });
  });

  it("issues a session cookie and persists a Session row once verified", async () => {
    const user = await mintUser(app);

    const session = await testPrisma.session.findFirst({
      where: { userId: user.id },
    });
    expect(session).not.toBeNull();
    expect(session?.token).toBeTruthy();
  });

  // Pins the attributes currently emitted. The test suite runs against an HTTP
  // BETTER_AUTH_URL (see `.env.test`), so the cookie is the lax plain shape —
  // `HttpOnly` + `SameSite=Lax`, with neither `Secure` nor `Domain`. The
  // production HTTPS shape (Secure + cross-subdomain scope) is exercised by
  // the unit suite in `cookieAttributes.test.ts`, which is what actually pins
  // the derivation — supertest re-parses attributes but does not enforce them
  // against a real browser's storage rules.
  it("emits a HttpOnly, lax session cookie with no `Secure` or `Domain` over HTTP", async () => {
    const email = "cookie@example.test";
    await request(app)
      .post("/api/auth/sign-up/email")
      .send({ email, password: TEST_PASSWORD, name: "Cookie User" });
    await testPrisma.user.update({
      where: { email },
      data: { emailVerified: true },
    });

    const res = await request(app)
      .post("/api/auth/sign-in/email")
      .send({ email, password: TEST_PASSWORD });

    const setCookie = (res.headers["set-cookie"] as unknown as string[]) ?? [];
    const sessionCookie = setCookie.find((c) => c.startsWith("better-auth.session_token"));

    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toMatch(/HttpOnly/i);
    expect(sessionCookie).toMatch(/SameSite=Lax/i);
    expect(sessionCookie).not.toMatch(/Secure/i);
    expect(sessionCookie).not.toMatch(/Domain=/i);
  });

  it("rejects an anonymous request to a protected route", async () => {
    const res = await request(app).get("/api/workspace");

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({
      success: false,
      message: "Unauthorized",
      responseObject: null,
      statusCode: 401,
    });
  });

  it("accepts a request carrying a valid session cookie", async () => {
    const user = await mintUser(app);

    const res = await as(app, user).get("/api/workspace");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, statusCode: 200 });
    expect(res.body.responseObject).toEqual([]);
  });

  it("invalidates the session on sign-out", async () => {
    const user = await mintUser(app);

    const signedOut = await as(app, user).post("/api/auth/sign-out").send({});
    expect(signedOut.status).toBeLessThan(400);

    const after = await as(app, user).get("/api/workspace");
    expect(after.status).toBe(401);
  });

  it("redirects the Google OAuth callback when state is missing", async () => {
    const res = await request(app).get("/api/auth/callback/google");

    // better-auth redirects on an OAuth state mismatch rather than returning a
    // 4xx — pinned as observed, since a caller relying on an error status would
    // be surprised. The provider is configured; this must not 500.
    expect([302, 303]).toContain(res.status);
    expect(res.headers.location).toBeTruthy();
  });
});

describe("http: auth — account deletion (Phase 1, plan §1.1–1.3)", () => {
  beforeEach(resetDatabase);

  // A user owning one workspace and *belonging*
  // to another deletes their account → owned workspace gone (with its
  // documents and messages), the non-owned workspace survives, the other
  // owner's messages remain, and the user's own messages in the non-owned
  // workspace are gone (Message.user is `onDelete: Cascade` — plan §1.5).
  it("cascades deletion to owned workspaces but leaves non-owned workspaces intact", async () => {
    const victim = await mintUser(app, { email: "victim@example.test" });
    const bystander = await mintUser(app, { email: "bystander@example.test" });

    // Workspace the victim owns — must be deleted with everything in it.
    const ownedWs = await createWorkspace(victim.id, "Owned by victim");
    await createDocument(ownedWs.id, { title: "Owned doc" });
    await createMessage(ownedWs.id, victim.id, "Victim's owned message");

    // Workspace owned by someone else — must survive.
    const sharedWs = await createWorkspace(bystander.id, "Owned by bystander");
    await addMember(sharedWs.id, victim.id, "MEMBER");
    await createDocument(sharedWs.id, { title: "Shared doc" });
    await createMessage(sharedWs.id, victim.id, "Victim's shared message");
    await createMessage(sharedWs.id, bystander.id, "Bystander's shared message");

    const res = await as(app, victim)
      .post("/api/auth/delete-user")
      .send({ password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, message: "User deleted" });

    // The user row is gone.
    await expect(
      testPrisma.user.findUnique({ where: { id: victim.id } }),
    ).resolves.toBeNull();

    // The owned workspace is gone, along with its documents and messages.
    await expect(
      testPrisma.workspace.findUnique({ where: { id: ownedWs.id } }),
    ).resolves.toBeNull();
    await expect(
      testPrisma.document.findMany({ where: { workspaceId: ownedWs.id } }),
    ).resolves.toEqual([]);
    await expect(
      testPrisma.message.findMany({ where: { workspaceId: ownedWs.id } }),
    ).resolves.toEqual([]);

    // The shared workspace survives intact, with its bystander membership and
    // bystander-authored message untouched.
    await expect(
      testPrisma.workspace.findUnique({ where: { id: sharedWs.id } }),
    ).resolves.toMatchObject({ name: "Owned by bystander" });
    await expect(
      testPrisma.workspaceMember.findUnique({
        where: {
          userId_workspaceId: { userId: bystander.id, workspaceId: sharedWs.id },
        },
      }),
    ).resolves.toMatchObject({ role: "OWNER" });
    await expect(
      testPrisma.message.findMany({
        where: { workspaceId: sharedWs.id, userId: bystander.id },
      }),
    ).resolves.toHaveLength(1);

    // Consequence: Message.user is `onDelete: Cascade`, so the
    // victim's own messages in the shared workspace are also gone — other
    // members see holes in their chat history with no tombstone.
    await expect(
      testPrisma.message.findMany({
        where: { workspaceId: sharedWs.id, userId: victim.id },
      }),
    ).resolves.toEqual([]);

    // The bystander's session is unaffected — they can still reach the API.
    const bystanderRes = await as(app, bystander).get("/api/workspace");
    expect(bystanderRes.status).toBe(200);
  });

  // The freshness gate: a session older than `freshAge` (24h)
  // cannot delete the account unless `password` is sent. This is the trap
  // 1d has to handle in the UI.
  it("refuses to delete via a >24h-old session when no password is supplied", async () => {
    const user = await mintUser(app);

    // Backdate the session. The freshness gate (better-auth) reads
    // `session.createdAt` and rejects when `now - createdAt >= freshAge`.
    await testPrisma.session.updateMany({
      where: { userId: user.id },
      data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    });

    const res = await as(app, user).post("/api/auth/delete-user").send({});

    // better-auth returns BAD_REQUEST for the freshness failure with code
    // SESSION_EXPIRED — pinned as observed so a 1d dialog relying on the
    // code (to drive the re-login flow) does not break silently.
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "SESSION_EXPIRED" });

    // The user row is untouched — the failure direction is safe (plan §1.3).
    await expect(
      testPrisma.user.findUnique({ where: { id: user.id } }),
    ).resolves.toMatchObject({ email: user.email });
  });

  // Same backdated session, but with `password` — the freshness gate is
  // bypassed entirely and the delete succeeds. This is also the better design
  // for an irreversible action: it re-authenticates (plan §1.3).
  it("accepts the same stale session when the correct password is supplied", async () => {
    const user = await mintUser(app);

    await testPrisma.session.updateMany({
      where: { userId: user.id },
      data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    });

    const res = await as(app, user)
      .post("/api/auth/delete-user")
      .send({ password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true });

    await expect(
      testPrisma.user.findUnique({ where: { id: user.id } }),
    ).resolves.toBeNull();
  });

  // NimbusBot owns no workspaces by construction, and the guard
  // skips the cascade outright. Better-auth's own delete still cascades the
  // bot's membership and message rows — but it cannot get to "owns every
  // workspace in the system" because the bot owns none.
  //
  // Exercised by calling the policy directly: the bot cannot sign in, so
  // reaching the actual `/api/auth/delete-user` endpoint with a bot session
  // would mean minting one by hand. The policy is the thing the guard lives
  // in, so the guard is what we test.
  it("does not cascade workspaces when the user being deleted is NimbusBot", async () => {
    const botId = process.env.BOT_USERID;
    expect(botId).toBeTruthy();

    // Give the bot an OWNER row in some workspace — the guard must still
    // skip the cascade, even though the bot *should* never hold OWNER by
    // construction. The guard's whole purpose is to be defensive against
    // exactly this data shape.
    const botWorkspace = await createWorkspace(botId!, "Bot owns this");
    await createDocument(botWorkspace.id);
    await createMessage(botWorkspace.id, botId!, "Bot message");

    const result = await cascadeOwnedWorkspaces({ id: botId! });

    expect(result.deletedCount).toBe(0);
    await expect(
      testPrisma.workspace.findUnique({ where: { id: botWorkspace.id } }),
    ).resolves.toMatchObject({ name: "Bot owns this" });
  });

  // A user who owns *no* workspaces hits the no-op branch and
  // returns zero deleted workspaces. The cascade must not error.
  it("is a no-op for a user who owns no workspaces", async () => {
    const owner = await createUser("Plain user");
    const sharedWs = await createWorkspace(
      (await mintUser(app)).id,
      "Shared",
    );
    await addMember(sharedWs.id, owner.id, "MEMBER");

    const result = await cascadeOwnedWorkspaces({ id: owner.id });

    expect(result.deletedCount).toBe(0);
    await expect(
      testPrisma.workspace.findUnique({ where: { id: sharedWs.id } }),
    ).resolves.not.toBeNull();
  });
});

describe("http: auth — password reset (Phase 1, plan §1.4)", () => {
  beforeEach(resetDatabase);

  // A password reset terminates every other live session.
  // Otherwise the control a compromised account exercises leaves the
  // attacker's session alive. End-to-end: request reset, fetch the token
  // better-auth wrote to the verification table, hit the reset endpoint,
  // and confirm the previously-minted session no longer works.
  it("revokes previously-minted sessions when the password is reset", async () => {
    const user = await mintUser(app);

    // Sanity check: the session works before the reset.
    const before = await as(app, user).get("/api/workspace");
    expect(before.status).toBe(200);

    // Trigger the reset flow.
    await request(app)
      .post("/api/auth/request-password-reset")
      .send({ email: user.email, redirectTo: "http://localhost:3000/reset" });

    // better-auth persists the token in the `Verification` table under
    // identifier `reset-password:<token>`. We have to read it back — there
    // is no API for the email recipient in tests.
    const verification = await testPrisma.verification.findFirst({
      where: {
        identifier: { startsWith: "reset-password:" },
        value: user.id,
      },
    });
    expect(verification).not.toBeNull();
    const token = verification!.identifier.split("reset-password:")[1];

    const reset = await request(app)
      .post("/api/auth/reset-password")
      .send({ newPassword: "Brand-New-Password-456!", token });

    expect(reset.status).toBe(200);
    expect(reset.body).toMatchObject({ status: true });

    // The old session is now invalid — the server returns 401.
    const after = await as(app, user).get("/api/workspace");
    expect(after.status).toBe(401);

    // And the session row is gone from the database (or at least: no session
    // row tied to this user remains).
    const remaining = await testPrisma.session.findMany({
      where: { userId: user.id },
    });
    expect(remaining).toEqual([]);
  });
});

// Single teardown for every describe in this file. Each describe above resets
// the database in `beforeEach`, but only one `afterAll` should release the
// shared Prisma/Redis pools — running `closeTestResources` from inside any
// describe closes Redis before the next describe's `resetDatabase` runs.
afterAll(closeTestResources);
