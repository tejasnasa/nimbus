import { test as setup, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Mints one `storageState` file per seeded user.
 *
 * @important Why this does not simply fill in the sign-in form
 *
 * The auth layer pins `defaultCookieAttributes.domain` to `.tejasnasa.me` and
 * `secure: true`. A browser will not accept a cookie scoped to an unrelated
 * domain, so signing in through the UI against `localhost` leaves the context
 * unauthenticated — the sign-in appears to succeed and every subsequent request
 * is anonymous. Rather than change production cookie settings to suit the test
 * suite, this setup signs in over the HTTP API, reads the raw `Set-Cookie`
 * header, and re-injects the same name/value pair scoped to `localhost`.
 *
 * The domain attribute is enforced by the client, not the server: the API reads
 * the session cookie by name, so re-scoping it is transparent to the backend.
 */

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";

interface E2EState {
  password: string;
  users: Record<"owner" | "member", { id: string; email: string }>;
}

const state: E2EState = JSON.parse(
  readFileSync(resolve(import.meta.dirname, ".auth/e2e-state.json"), "utf8"),
);

/**
 * Extracts `name=value` pairs from raw `Set-Cookie` headers, discarding the
 * attributes. Cookie values may themselves contain `=`, so only the first one
 * separates name from value.
 */
function parseCookies(headers: { name: string; value: string }[]) {
  const cookies = new Map<string, string>();

  for (const header of headers) {
    if (header.name.toLowerCase() !== "set-cookie") continue;

    const pair = header.value.split(";")[0] ?? "";
    const separator = pair.indexOf("=");
    if (separator === -1) continue;

    cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1));
  }

  return cookies;
}

for (const role of ["owner", "member"] as const) {
  setup(`authenticate as the workspace ${role}`, async ({ browser, request }) => {
    const user = state.users[role];

    const response = await request.post(`${API_BASE}/api/auth/sign-in/email`, {
      data: { email: user.email, password: state.password },
      headers: { Origin: "http://localhost:3000" },
    });

    expect(
      response.status(),
      `Sign-in for ${user.email} failed — is the seed still applied?`,
    ).toBe(200);

    const cookies = parseCookies(response.headersArray());
    const sessionCookie = [...cookies].find(([name]) => name.includes("session"));
    expect(
      sessionCookie,
      "Sign-in returned no session cookie; the auth config or password hash changed.",
    ).toBeDefined();

    const context = await browser.newContext();
    await context.addCookies(
      [...cookies].map(([name, value]) => ({
        name,
        value,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        // The injected cookie is sent over plain HTTP, so it must not be marked
        // secure; only the server's own `Set-Cookie` decides that.
        secure: false,
        sameSite: "Lax" as const,
      })),
    );
    await context.storageState({ path: resolve(import.meta.dirname, `.auth/${role}.json`) });
    await context.close();
  });
}
