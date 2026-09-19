import type { Page } from "@playwright/test";
import { test, expect, e2eState } from "./fixtures";

/**
 * The credential forms' client-side behaviour.
 *
 * @important Two things about this screen shape every locator below, and both
 *            stem from recorded defects rather than from the spec's preference:
 *
 *            1. `FormSwitch` mounts the sign-in, sign-up and forgot-password
 *               cards **simultaneously** and swaps them with `opacity-0` +
 *               `pointer-events-none`. Nothing is unmounted, `display: none` is
 *               never used, and `opacity: 0` still counts as visible to
 *               Playwright — so every `getByLabel("Email")` on this page matches
 *               more than one element, and "which card is showing" is only
 *               observable as that opacity.
 *            2. `LoginForm` and `SignupForm` both hard-code `id="email"` and
 *               `id="password"`, so the ids cannot disambiguate either.
 *
 *            Every locator is therefore scoped to the card that owns it, and the
 *            card switch is asserted through opacity.
 *
 * @important Only failure paths are exercised end to end here. A successful
 *            sign-in cannot be driven through the browser in this environment:
 *            the auth layer pins the session cookie to `Domain=.tejasnasa.me`
 *            with `secure: true`, which a browser refuses to store from
 *            `localhost`. The form submits, the API authenticates, and the
 *            context is still anonymous — so `auth.setup.ts` covers the accepted
 *            path by re-scoping the cookie it reads off the HTTP response.
 */

/** The card that owns the given heading, plus the wrapper that fades it. */
const card = (page: Page, heading: string) =>
  page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: heading, exact: true }) })
    .locator("xpath=..");

test.describe("auth", () => {
  test("bad credentials are rejected and the visitor stays on /login", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const login = card(page, "Welcome back");

    await page.goto("/login");
    await login.getByLabel("Email").fill(e2eState.users.owner.email);
    await login.getByLabel("Password").fill("definitely-not-the-password");
    await login.getByRole("button", { name: "Login" }).click();

    await expect(page).toHaveURL(/\/login$/);
    await expect(login.getByText(/invalid|incorrect|password/i).first()).toBeVisible();

    await context.close();
  });

  test("a malformed email is caught before the request", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const login = card(page, "Welcome back");

    let requests = 0;
    page.on("request", request => {
      if (request.url().includes("/api/auth/sign-in")) requests += 1;
    });

    await page.goto("/login");
    await login.getByLabel("Email").fill("not-an-email");
    await login.getByLabel("Password").fill("whatever");
    await login.getByRole("button", { name: "Login" }).click();

    // Zod runs in the resolver, so the client never reaches the API.
    await expect(page).toHaveURL(/\/login$/);
    expect(requests, "client-side validation should have blocked the request").toBe(0);

    await context.close();
  });

  test("the form switches between sign in and sign up", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    const login = card(page, "Welcome back");
    const signup = card(page, "Create your account");

    await page.goto("/login");
    await expect(login).toHaveCSS("opacity", "1");
    await expect(signup).toHaveCSS("opacity", "0");

    await login.getByRole("button", { name: /Sign up/ }).click();
    await expect(signup).toHaveCSS("opacity", "1");
    await expect(login).toHaveCSS("opacity", "0");

    await signup.getByRole("button", { name: /Sign in/ }).click();
    await expect(login).toHaveCSS("opacity", "1");

    await context.close();
  });

  test("forgot password brings its own card forward", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    const login = card(page, "Welcome back");
    const forgot = card(page, "Forgot password?");

    await page.goto("/login");
    await expect(forgot).toHaveCSS("opacity", "0");

    await login.getByRole("button", { name: "Forgot password?" }).click();

    await expect(forgot).toHaveCSS("opacity", "1");
    await expect(login).toHaveCSS("opacity", "0");
    // The URL is unchanged — this is a card swap, not a navigation.
    await expect(page).toHaveURL(/\/login$/);

    await context.close();
  });

  test("/reset-password renders for a visitor holding a token", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto("/reset-password?token=e2e-reset-token");

    await expect(page).toHaveURL(/\/reset-password/);
    await expect(page.locator("input[type='password']").first()).toBeVisible();

    await context.close();
  });

  test("/reset-password without a token redirects to /login", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    // The page redirects rather than rendering an empty form, because there is
    // no token to submit.
    await page.goto("/reset-password?token=");

    await expect(page).toHaveURL(/\/login$/);

    await context.close();
  });
});
