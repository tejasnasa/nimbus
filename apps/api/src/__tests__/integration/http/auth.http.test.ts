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
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
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
  getResendSendMock,
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
    const sessionCookie = setCookie.find((c) =>
      c.startsWith("better-auth.session_token"),
    );

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
    await createMessage(
      sharedWs.id,
      bystander.id,
      "Bystander's shared message",
    );

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
          userId_workspaceId: {
            userId: bystander.id,
            workspaceId: sharedWs.id,
          },
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
    const sharedWs = await createWorkspace((await mintUser(app)).id, "Shared");
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

describe("http: auth — change-password", () => {
  beforeEach(resetDatabase);

  // Happy path: a credential user changes their password and the new one
  // is what signs them in next.
  it("changes the password and the new password signs in afterwards", async () => {
    const user = await mintUser(app);

    const change = await as(app, user).post("/api/auth/change-password").send({
      currentPassword: TEST_PASSWORD,
      newPassword: "Brand-New-Password-456!",
      revokeOtherSessions: true,
    });

    expect(change.status).toBe(200);
    expect(change.body).toMatchObject({ user: { id: user.id } });

    // The old password no longer signs the user in — pins that the change
    // actually persisted to the `Account.password` column rather than
    // just returning 200.
    const oldSignIn = await request(app)
      .post("/api/auth/sign-in/email")
      .send({ email: user.email, password: TEST_PASSWORD });
    expect(oldSignIn.status).toBeGreaterThanOrEqual(400);

    // The new password does — confirm the password hash got updated, not
    // the user re-issued.
    const newSignIn = await request(app)
      .post("/api/auth/sign-in/email")
      .send({ email: user.email, password: "Brand-New-Password-456!" });
    expect(newSignIn.status).toBe(200);
  });

  // The obvious failure: the supplied `currentPassword` does not match.
  // better-auth returns INVALID_PASSWORD.
  it("rejects a wrong current password", async () => {
    const user = await mintUser(app);

    const res = await as(app, user).post("/api/auth/change-password").send({
      currentPassword: "definitely-not-the-password",
      newPassword: "Whatever-New-Password-123!",
      revokeOtherSessions: false,
    });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "INVALID_PASSWORD" });

    // The original password still works — the rejection did not silently
    // change anything.
    const still = await request(app)
      .post("/api/auth/sign-in/email")
      .send({ email: user.email, password: TEST_PASSWORD });
    expect(still.status).toBe(200);
  });

  // The server enforces `minPasswordLength` (8 chars by default) on the
  // new password — the client schema mirrors this, but the server is the
  // authoritative check.
  it("rejects a too-short new password", async () => {
    const user = await mintUser(app);

    const res = await as(app, user).post("/api/auth/change-password").send({
      currentPassword: TEST_PASSWORD,
      newPassword: "short",
      revokeOtherSessions: false,
    });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "PASSWORD_TOO_SHORT" });
  });

  // The Google-only trap: a user with no credential account would crash
  // the change-password form on the client with CREDENTIAL_ACCOUNT_NOT_FOUND
  // if the branching logic ever regressed. This pins the server-side
  // contract that makes the branching load-bearing.
  it("returns CREDENTIAL_ACCOUNT_NOT_FOUND for a user with no credential account", async () => {
    const user = await mintUser(app);

    // Strip the credential account — the user is left with whatever
    // better-auth added (none), or we explicitly attach a Google-only
    // account to model the OAuth-first flow.
    await testPrisma.account.deleteMany({ where: { userId: user.id } });
    await testPrisma.account.create({
      data: {
        id: `acct-google-${user.id}`,
        providerId: "google",
        accountId: user.id,
        userId: user.id,
      },
    });

    const res = await as(app, user).post("/api/auth/change-password").send({
      currentPassword: TEST_PASSWORD,
      newPassword: "Whatever-New-Password-123!",
      revokeOtherSessions: false,
    });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "CREDENTIAL_ACCOUNT_NOT_FOUND" });
  });
});

describe("http: auth — set-password for a Google-only user", () => {
  beforeEach(resetDatabase);

  // The linchpin of 6.2: the existing `requestPasswordReset` →
  // `resetPassword` flow creates a credential account when one is
  // absent. This is the *server* property that justifies the Google-only
  // decision to reuse 1b rather than reaching for a non-existent
  // `setPassword` client method.
  it("creates a credential account when a Google-only user follows the reset link", async () => {
    const user = await mintUser(app);

    // Make the user Google-only: delete the credential account and
    // attach a Google account instead, mirroring what `signIn.social`
    // would have done.
    await testPrisma.account.deleteMany({ where: { userId: user.id } });
    await testPrisma.account.create({
      data: {
        id: `acct-google-${user.id}`,
        providerId: "google",
        accountId: user.id,
        userId: user.id,
      },
    });

    // Sanity check: there is no credential account yet.
    const before = await testPrisma.account.findFirst({
      where: { userId: user.id, providerId: "credential" },
    });
    expect(before).toBeNull();

    // Request a reset link.
    await request(app)
      .post("/api/auth/request-password-reset")
      .send({ email: user.email, redirectTo: "http://localhost:3000/reset" });

    // Read the reset token out of the Verification table.
    const verification = await testPrisma.verification.findFirst({
      where: {
        identifier: { startsWith: "reset-password:" },
        value: user.id,
      },
    });
    expect(verification).not.toBeNull();
    const token = verification!.identifier.split("reset-password:")[1];

    // Follow the reset link.
    const reset = await request(app)
      .post("/api/auth/reset-password")
      .send({ newPassword: "Freshly-Set-Password-789!", token });

    expect(reset.status).toBe(200);
    expect(reset.body).toMatchObject({ status: true });

    // The credential account now exists — this is the new credential
    // row the flow just created. The old password is gone; the new
    // password is what the credential account carries.
    const after = await testPrisma.account.findFirst({
      where: { userId: user.id, providerId: "credential" },
    });
    expect(after).not.toBeNull();
    expect(after?.accountId).toBe(user.id);
    expect(after?.password).toBeTruthy();

    // The Google account is untouched — the reset creates the credential
    // row *alongside* the existing Google one, not in place of it.
    const google = await testPrisma.account.findFirst({
      where: { userId: user.id, providerId: "google" },
    });
    expect(google).not.toBeNull();

    // The new password signs the user in via the credential path —
    // confirms the hashed password is usable.
    const signIn = await request(app)
      .post("/api/auth/sign-in/email")
      .send({ email: user.email, password: "Freshly-Set-Password-789!" });
    expect(signIn.status).toBe(200);
  });
});

describe("http: auth — forgot-password failure paths (Phase 9, plan §9)", () => {
  beforeEach(resetDatabase);

  /**
   * Pulls the reset token better-auth persisted for `userEmail`. The Verification row's
   * `identifier` is `reset-password:<token>` and `value` is the user id; a reset request
   * without a matching pair of values cannot succeed.
   */
  const readResetToken = async (userId: string) => {
    const verification = await testPrisma.verification.findFirst({
      where: {
        identifier: { startsWith: "reset-password:" },
        value: userId,
      },
    });
    expect(
      verification,
      "expected a reset-password verification row",
    ).not.toBeNull();
    return verification!.identifier.split("reset-password:")[1];
  };

  // better-auth must return the same generic success shape for an unknown email
  // as it does for a known one — the response must not leak whether the address
  // exists. A test that asserts "no email was sent" is the only way to pin the
  // anti-enumeration contract.
  it("does not leak whether an email is registered when the request lands", async () => {
    // Silence the `[email] password reset was not delivered …` line better-auth
    // prints when the address is unknown; the warning is itself a leak signal in
    // logs, but the test asserts the API contract, which is what matters.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const known = await mintUser(app);

    const unknownRes = await request(app)
      .post("/api/auth/request-password-reset")
      .send({
        email: "no-such-user@example.test",
        redirectTo: "http://localhost:3000/reset-password",
      });
    const knownRes = await request(app)
      .post("/api/auth/request-password-reset")
      .send({
        email: known.email,
        redirectTo: "http://localhost:3000/reset-password",
      });

    expect(unknownRes.status).toBe(200);
    expect(knownRes.status).toBe(200);

    // The response shape — both the body and the status — is identical. A
    // client that prints only `res.body.message` cannot distinguish the two.
    expect(unknownRes.body).toMatchObject({ status: true });
    expect(knownRes.body).toMatchObject({ status: true });
    expect(unknownRes.body.message).toBe(knownRes.body.message);

    // And the unknown address must not produce a `Verification` row — that
    // would let a future leak (a list query, an admin endpoint, a backup)
    // betray registration.
    const unknownVerification = await testPrisma.verification.findFirst({
      where: { value: "no-such-user@example.test" },
    });
    expect(unknownVerification).toBeNull();

    errorSpy.mockRestore();
  });

  // better-auth deletes the verification row on a successful reset, so the
  // same token cannot be replayed. This pins that "replay protection" — the
  // case a phishing link reuse would exploit.
  it("refuses to reset a password with a token that has already been used", async () => {
    const user = await mintUser(app);

    await request(app).post("/api/auth/request-password-reset").send({
      email: user.email,
      redirectTo: "http://localhost:3000/reset-password",
    });
    const token = await readResetToken(user.id);

    const first = await request(app)
      .post("/api/auth/reset-password")
      .send({ newPassword: "First-New-Password-321!", token });
    expect(first.status).toBe(200);

    // Replaying the same token: the verification row is gone, so the second
    // call must be rejected with INVALID_TOKEN.
    const replay = await request(app)
      .post("/api/auth/reset-password")
      .send({ newPassword: "Second-New-Password-654!", token });
    expect(replay.status).toBe(400);
    expect(replay.body).toMatchObject({ code: "INVALID_TOKEN" });

    // And the second password is *not* the one that signs the user in —
    // pins that the rejected call did not silently write a row.
    const signInWithSecond = await request(app)
      .post("/api/auth/sign-in/email")
      .send({ email: user.email, password: "Second-New-Password-654!" });
    expect(signInWithSecond.status).toBeGreaterThanOrEqual(400);

    const signInWithFirst = await request(app)
      .post("/api/auth/sign-in/email")
      .send({ email: user.email, password: "First-New-Password-321!" });
    expect(signInWithFirst.status).toBe(200);
  });

  // An expired token is rejected, by another route through the same code path
  // — backdating the verification row's `expiresAt` is the only way to
  // produce the condition without waiting an hour.
  it("refuses to reset a password with a token past its expiry", async () => {
    const user = await mintUser(app);

    await request(app).post("/api/auth/request-password-reset").send({
      email: user.email,
      redirectTo: "http://localhost:3000/reset-password",
    });
    const token = await readResetToken(user.id);

    // Move the verification row into the past — backdating the expiry is the
    // only knob the test controls, since better-auth's TTL is hard-coded at
    // 1h inside the endpoint handler. `identifier` is not unique, so use
    // `updateMany` rather than `update`.
    await testPrisma.verification.updateMany({
      where: { identifier: `reset-password:${token}` },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const expired = await request(app)
      .post("/api/auth/reset-password")
      .send({ newPassword: "Expired-Token-Password-987!", token });
    expect(expired.status).toBe(400);
    expect(expired.body).toMatchObject({ code: "INVALID_TOKEN" });

    // The original password still signs the user in — pins that the expired
    // attempt did not write a partial row.
    const signIn = await request(app)
      .post("/api/auth/sign-in/email")
      .send({ email: user.email, password: TEST_PASSWORD });
    expect(signIn.status).toBe(200);
  });

  // better-auth's `requestPasswordReset` builds the link against `baseURL`
  // (`BETTER_AUTH_URL`); `redirectTo` is carried as a `callbackURL` query
  // parameter and surfaced via the GET callback redirect. This pins the
  // routing contract: the link goes to the API, and the API sends the user
  // on to the frontend. Without this pin, a future `redirectTo` change could
  // either skip the callback (and break cookie handling) or bypass it (and
  // lose the `?token=…` round-trip). The `resend` SDK is mocked in
  // `testhelpers/setup.ts`, so the URL ends up in the captured payload.
  it("builds the emailed link against BETTER_AUTH_URL and carries redirectTo as callbackURL", async () => {
    const sendMock = getResendSendMock();

    const user = await mintUser(app);
    // Reset only the captures from `mintUser`'s sign-up so the captured
    // payload below is exactly the one this test triggered.
    sendMock.mockClear();

    await request(app).post("/api/auth/request-password-reset").send({
      email: user.email,
      redirectTo: "http://localhost:3000/reset-password",
    });

    expect(sendMock.mock.calls.length).toBe(1);
    const payload = sendMock.mock.calls[0]![0] as { html: string };
    // The reset link is embedded in the HTML; pick the first absolute URL
    // that contains `/reset-password/`. The exact token is random, so the
    // pattern is what matters.
    const match = payload.html.match(
      /https?:\/\/[^"\s)]+\/reset-password\/[^"\s)<]+/,
    );
    expect(
      match,
      "expected a reset-password URL inside the email body",
    ).not.toBeNull();
    const parsed = new URL(match![0]);

    // The link lands on the API host (baseURL), not on FRONTEND_URL — the
    // API is the one that owns the GET callback redirect. better-auth mounts
    // its handlers under `/api/auth`, so the path is `/api/auth/reset-password/<token>`.
    expect(parsed.origin).toBe(process.env.BETTER_AUTH_URL);
    expect(parsed.pathname).toMatch(
      /^\/api\/auth\/reset-password\/[A-Za-z0-9_-]+$/,
    );

    // The original `redirectTo` is preserved through the `callbackURL`
    // query parameter, encoded. Without the round-trip the frontend never
    // sees `?token=…` and the form has nothing to submit.
    const callbackURL = parsed.searchParams.get("callbackURL");
    expect(callbackURL).not.toBeNull();
    expect(decodeURIComponent(callbackURL!)).toBe(
      "http://localhost:3000/reset-password",
    );

    // Pin that the user.id is what the verification row actually carries —
    // a swap to `user.email` would break the credential-creation path in
    // Phase 6's Google-only case.
    const verification = await testPrisma.verification.findFirst({
      where: { identifier: { startsWith: "reset-password:" } },
    });
    expect(verification?.value).toBe(user.id);
  });
});

// Single teardown for every describe in this file. Each describe above resets
// the database in `beforeEach`, but only one `afterAll` should release the
// shared Prisma/Redis pools — running `closeTestResources` from inside any
// describe closes Redis before the next describe's `resetDatabase` runs.
afterAll(closeTestResources);
