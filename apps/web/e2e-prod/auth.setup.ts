import { test as setup, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { card } from "./fixtures";
import {
  apiUrl,
  AUTH_DIR,
  SMOKE_STALE_AFTER_MS,
  SMOKE_WORKSPACE_PREFIX,
  users,
  webUrl,
} from "./env";

/**
 * Signs the two smoke accounts in and mints the session cookies every
 * authenticated spec depends on.
 *
 * @important This drives the real sign-in form, unlike the local suite's
 *            `auth.setup.ts`, which posts to the API and re-scopes the cookie it
 *            gets back. That workaround exists only because `localhost` cannot
 *            hold a `Secure` cookie scoped to a real domain. In production the
 *            browser is on the real origin and the cookie is stored normally, so
 *            the form is the honest path — and the cross-subdomain cookie, the
 *            CORS origin and `trustedOrigins` are all covered by it for free.
 *
 * @important Do not "simplify" the failure branch below into a plain URL
 *            assertion. When `AUTH_COOKIE_DOMAIN` is unset the cookie is scoped
 *            to the API host alone, sign-in still returns 200, and the symptom
 *            is `proxy.ts` bouncing `/home` back to `/login` — which reads as a
 *            broken form rather than a cookie-scope problem.
 */

mkdirSync(AUTH_DIR, { recursive: true });

for (const role of ["owner", "member"] as const) {
  setup(`signs in as the smoke ${role}`, async ({ page, context }) => {
    const user = users[role];

    await page.goto("/login");

    const login = card(page, "Welcome back");
    await login.getByLabel("Email").fill(user.email);
    await login.getByLabel("Password").fill(user.password);
    await login.getByRole("button", { name: "Login" }).click();

    try {
      await expect(page).toHaveURL(/\/home$/, { timeout: 30_000 });
    } catch {
      const session = (await context.cookies()).find((cookie) =>
        cookie.name.includes("session"),
      );
      const webHost = new URL(webUrl).hostname;

      throw new Error(
        `Sign-in as ${user.email} did not reach /home (landed on ${page.url()}). ` +
          (session
            ? `The session cookie is scoped to "${session.domain}" — for the ` +
              `server-side guard and the navbar to see it, it must cover ` +
              `"${webHost}". Check AUTH_COOKIE_DOMAIN and BETTER_AUTH_URL.`
            : "No session cookie was set at all — check BETTER_AUTH_URL and " +
              "that the API's FRONTEND_URL matches the origin being tested."),
      );
    }

    // A reload distinguishes a genuinely persisted session from a client-side
    // redirect that happens to have rendered `/home` once.
    await page.reload();
    await expect(page).toHaveURL(/\/home$/);

    await context.storageState({ path: `${AUTH_DIR}/${role}.json` });
  });
}

/**
 * Reaps workspaces a previous run left behind.
 *
 * A crash between creating a workspace and deleting it leaves an orphan, and a
 * nightly cadence would accumulate them silently. Only names carrying the smoke
 * prefix are considered, so this can never reach a workspace a real person made,
 * and only ones older than the staleness window — which keeps a long manual run
 * from having the workspace deleted out from under it.
 *
 * Runs after the sign-ins so it can reuse the owner's cookie jar, and calls the
 * API host directly: the web host has no `/api` rewrite, so a request based on
 * the web origin would 404 and clean up nothing.
 */
setup("sweeps stale smoke workspaces", async ({ browser }) => {
  const context = await browser.newContext({
    storageState: `${AUTH_DIR}/owner.json`,
  });

  try {
    const listed = await context.request.get(`${apiUrl}/api/workspace/`);
    expect(listed.status(), "listing workspaces for the janitor failed").toBe(200);

    const body = await listed.json();
    const workspaces = (body.responseObject ?? []) as Array<{
      id: string;
      name: string;
      updatedAt: string;
    }>;

    const cutoff = Date.now() - SMOKE_STALE_AFTER_MS;
    const stale = workspaces.filter(
      (workspace) =>
        workspace.name?.startsWith(SMOKE_WORKSPACE_PREFIX) &&
        new Date(workspace.updatedAt).getTime() < cutoff,
    );

    for (const workspace of stale) {
      // `:wsid` is the cuid `id`, not the numeric `slugId` the URL carries —
      // passing the slug yields a 404 that reads exactly like "already gone".
      const deleted = await context.request.delete(
        `${apiUrl}/api/workspace/delete/${workspace.id}`,
      );

      // A workspace the owner was only invited to returns 403; one failure must
      // not abort the sweep.
      if (!deleted.ok()) {
        console.warn(
          `janitor: could not delete ${workspace.id} (${deleted.status()})`,
        );
      }
    }
  } finally {
    await context.close();
  }
});
