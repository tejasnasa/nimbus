/**
 * @module testhelpers/session
 * @description Mints real better-auth sessions by driving the app's own
 * `/api/auth/*` endpoints against the test database. Sessions are created
 * through the real sign-up → verify → sign-in flow (never a forged cookie), so
 * the auth configuration under test is the one that actually runs.
 *
 * @important Requests here replay only the `name=value` pair and discard the
 *            attributes (`HttpOnly`, `Secure`, `Domain`, …). supertest accepts
 *            a cookie without enforcing those attributes, so the suite keeps
 *            working even when the server is configured with attributes a real
 *            browser would not store.
 */
import { randomUUID } from "node:crypto";
import type { Express } from "express";
import request from "supertest";
import { testPrisma } from "./database";

/** Password used for every minted user. Satisfies the signup strength rules. */
export const TEST_PASSWORD = "Test-Password-123!";

/** A signed-in test user. */
export type TestUser = {
  id: string;
  email: string;
  name: string;
  /** Ready-to-send `Cookie` header value for `authCheck`-protected requests. */
  cookie: string;
};

/** Keeps only the `name=value` pairs, dropping `Domain`/`Secure`/etc. */
const toCookieHeader = (setCookie: string[] | undefined): string =>
  (setCookie ?? [])
    .map((entry) => entry.split(";")[0]?.trim())
    .filter((entry): entry is string => Boolean(entry))
    .join("; ");

/**
 * Creates a verified user and signs it in.
 *
 * @param app - The Express app under test.
 * @param overrides - Optional name/email/password overrides.
 * @returns The user's id, credentials, and a replayable session cookie.
 */
export const mintUser = async (
  app: Express,
  overrides: { name?: string; email?: string; password?: string } = {},
): Promise<TestUser> => {
  const email = overrides.email ?? `test-${randomUUID()}@example.test`;
  const password = overrides.password ?? TEST_PASSWORD;
  const name = overrides.name ?? "Test User";

  const signUp = await request(app)
    .post("/api/auth/sign-up/email")
    .send({ email, password, name });

  if (signUp.status >= 400) {
    throw new Error(
      `sign-up failed (${signUp.status}): ${JSON.stringify(signUp.body)}`,
    );
  }

  const id = signUp.body.user?.id as string | undefined;
  if (!id) throw new Error(`sign-up returned no user: ${JSON.stringify(signUp.body)}`);

  // `requireEmailVerification` blocks sign-in until the address is verified.
  // Completing it here stands in for following the emailed link (delivery is
  // mocked — see testhelpers/setup.ts).
  await testPrisma.user.update({ where: { id }, data: { emailVerified: true } });

  const signIn = await request(app)
    .post("/api/auth/sign-in/email")
    .send({ email, password });

  if (signIn.status >= 400) {
    throw new Error(
      `sign-in failed (${signIn.status}): ${JSON.stringify(signIn.body)}`,
    );
  }

  const cookie = toCookieHeader(
    signIn.headers["set-cookie"] as unknown as string[] | undefined,
  );

  if (!cookie) throw new Error("sign-in returned no session cookie");

  return { id, email, name, cookie };
};

/** Builds supertest requests with the user's session cookie pre-attached. */
export const as = (app: Express, user: TestUser) => ({
  get: (url: string) => request(app).get(url).set("Cookie", user.cookie),
  post: (url: string) => request(app).post(url).set("Cookie", user.cookie),
  put: (url: string) => request(app).put(url).set("Cookie", user.cookie),
  delete: (url: string) => request(app).delete(url).set("Cookie", user.cookie),
});
