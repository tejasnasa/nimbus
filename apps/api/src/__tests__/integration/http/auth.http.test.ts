/**
 * @module api/__tests__/integration/http/auth
 * @description better-auth flows driven through its real mounted endpoints:
 * sign-up, email-verification gating, sign-in, session persistence, sign-out,
 * and the shape of the session cookie it issues.
 *
 * Sessions are minted through the real flow (see `testhelpers/session.ts`)
 * rather than forged, so the auth configuration under test is the one that runs.
 */
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../app";
import {
  TEST_PASSWORD,
  as,
  closeTestResources,
  mintUser,
  resetDatabase,
  testPrisma,
} from "@testhelpers";

const app = createApp();

describe("http: auth", () => {
  beforeEach(resetDatabase);
  afterAll(closeTestResources);

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

  // Pins the attributes currently emitted. See the cookie-domain note in
  // `src/lib/auth.ts`: `Domain=.tejasnasa.me` + `Secure` are production-shaped
  // and are applied unconditionally.
  it("emits a HttpOnly, Secure, domain-scoped session cookie", async () => {
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
    expect(sessionCookie).toMatch(/Secure/i);
    expect(sessionCookie).toMatch(/Domain=\.tejasnasa\.me/i);
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
