import { test as setup, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Mints one `storageState` file per seeded user by signing in through the real
 * sign-in form.
 *
 * The API derives its session-cookie attributes from `BETTER_AUTH_URL`, and the
 * test environment points that at `http://localhost:3001`, so the cookie is
 * issued without `Secure` or `Domain` and a browser on `localhost` stores it.
 * Signing in through the page therefore authenticates the context the same way
 * it does for a visitor, and the form itself is exercised by every run.
 */

interface E2EState {
  password: string;
  users: Record<"owner" | "member", { id: string; email: string }>;
}

const state: E2EState = JSON.parse(
  readFileSync(resolve(import.meta.dirname, ".auth/e2e-state.json"), "utf8"),
);

for (const role of ["owner", "member"] as const) {
  setup(`authenticate as the workspace ${role}`, async ({ browser }) => {
    const user = state.users[role];
    const context = await browser.newContext();
    const page = await context.newPage();

    // The sign-in, sign-up and forgot-password cards are mounted together, so
    // the fields are scoped to the sign-in card by its heading.
    const login = page
      .locator("section")
      .filter({
        has: page.getByRole("heading", { name: "Welcome back", exact: true }),
      })
      .locator("xpath=..");

    await page.goto("/login");
    await login.getByLabel("Email").fill(user.email);
    await login.getByLabel("Password").fill(state.password);
    await login.getByRole("button", { name: "Login" }).click();

    await page.waitForURL("**/home", { timeout: 30_000 });

    const cookies = await context.cookies();
    expect(
      cookies.some((cookie) => cookie.name.includes("session")),
      `Signing in as ${user.email} stored no session cookie; is the seed still applied, and does BETTER_AUTH_URL use http?`,
    ).toBe(true);

    await context.storageState({
      path: resolve(import.meta.dirname, `.auth/${role}.json`),
    });
    await context.close();
  });
}
