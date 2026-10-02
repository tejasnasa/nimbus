import { test, expect } from "@playwright/test";
import { apiUrl, webUrl } from "./env";

/**
 * The signed-out surface, plus the two checks that prove the deployed API is
 * reachable from the deployed web app.
 *
 * @important This project has no `dependencies`, so it runs even when sign-in
 *            is broken. That is the point: on a night when auth regresses, the
 *            report should still say whether the site and the API are up.
 */

test.describe("public surface", () => {
  test("the deployed web app answers", async ({ page }) => {
    const response = await page.goto("/");

    expect(
      response?.status(),
      `GET / on ${webUrl} did not return a successful response`,
    ).toBeLessThan(400);
  });

  test("an anonymous visitor is redirected away from /home", async ({ page }) => {
    await page.goto("/home");

    await expect(page).toHaveURL(/\/login$/);
    await expect(
      page.getByRole("heading", { name: "Welcome back" }),
    ).toBeVisible();
  });

  test("the credential cards render", async ({ page }) => {
    await page.goto("/login");

    // All three cards are mounted at once and swapped by opacity, so their
    // headings being present is the honest assertion that they shipped.
    await expect(
      page.getByRole("heading", { name: "Welcome back" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Create your account" }),
    ).toBeAttached();
    await expect(
      page.getByRole("heading", { name: "Forgot password?" }),
    ).toBeAttached();
  });

  test("/reset-password without a token redirects to /login", async ({ page }) => {
    await page.goto("/reset-password?token=");

    await expect(page).toHaveURL(/\/login$/);
  });

  test("the contact form renders without an account", async ({ page }) => {
    await page.goto("/contact");

    // Public by design — it is the page someone reaches for when something is
    // broken, so it has to work without a session.
    await expect(page.getByRole("heading", { name: "Get in touch" })).toBeVisible();
    await expect(page.getByLabel("Message")).toBeVisible();

    // The submission is deliberately never exercised: it is a live outbound
    // send through Resend, and the API's `deliver()` swallows failures, so a
    // 200 would prove nothing while tying the nightly to a third party.
  });

  test("the API accepts the deployed web origin", async ({ page }) => {
    await page.goto("/login");

    // Fetched from inside the page, so the browser applies CORS exactly as it
    // would for a real user. A mismatch between the API's FRONTEND_URL and this
    // origin fails here and nowhere else.
    const result = await page.evaluate(async (root: string) => {
      try {
        const response = await fetch(root, { credentials: "include" });
        return { reached: true, status: response.status };
      } catch (error) {
        return { reached: false, status: 0, error: String(error) };
      }
    }, apiUrl);

    expect(
      result.reached,
      `Cross-origin fetch to ${apiUrl} was blocked — check the API's FRONTEND_URL. ${JSON.stringify(result)}`,
    ).toBe(true);
    expect(result.status).toBe(200);
  });

  test("the health endpoint reports both dependencies up", async ({ page }) => {
    await page.goto("/login");

    const result = await page.evaluate(async (root: string) => {
      const response = await fetch(`${root}/api/health`);
      const body = await response.json();
      return { status: response.status, body };
    }, apiUrl);

    expect(
      result.status,
      `GET ${apiUrl}/api/health returned ${result.status}. A 404 means the ` +
        "deployed API predates this route — check that the droplet is running " +
        "the current main.",
    ).toBe(200);
    expect(result.body).toMatchObject({
      success: true,
      responseObject: {
        status: "ok",
        checks: { database: { ok: true }, redis: { ok: true } },
      },
    });
  });
});
