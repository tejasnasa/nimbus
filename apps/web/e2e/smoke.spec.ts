import { test, expect, e2eState } from "./fixtures";

/**
 * The harness's own canary.
 *
 * Every other spec assumes two things: that the seeded session is genuinely
 * authenticated, and that the two processes are wired to the throwaway stack.
 * Both fail silently — a rejected cookie looks like a redirect to `/login`, and
 * a mis-pointed `DATABASE_URL` looks like an empty dashboard. This file pins
 * them so a broken harness is never mistaken for a broken feature.
 */

test.describe("smoke", () => {
  test("an anonymous visitor is redirected away from /home", async ({
    browser,
  }) => {
    // A context with no `storageState` is the only way to be anonymous here — the
    // project-level state would otherwise authenticate every request.
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto("/home");

    await expect(page).toHaveURL(/\/login$/);
    await expect(
      page.getByRole("heading", { name: "Welcome back" }),
    ).toBeVisible();

    await context.close();
  });

  test("the seeded owner sees their workspace on the dashboard", async ({
    page,
  }) => {
    await page.goto("/home");

    // The card links to the workspace by slugId and carries that id as its DOM
    // id, which is stabler than the rendered name.
    const card = page.locator(`[id="${e2eState.workspace.slugId}"]`);
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute(
      "href",
      `/workspace/${e2eState.workspace.slugId}`,
    );
  });

  test("opening the workspace renders its room without throwing", async ({
    page,
  }) => {
    const failures: string[] = [];
    page.on("pageerror", error => failures.push(error.message));

    await page.goto(`/workspace/${e2eState.workspace.slugId}`);

    await expect(
      page.getByRole("heading", { name: "E2E Workspace", level: 1 }),
    ).toBeVisible();

    // The room composes Chat beside DocEditor; both are server-rendered shells
    // that hydrate against the socket, so their presence proves the data load
    // succeeded rather than falling through to `not-found`.
    await expect(page.getByText("E2E Workspace")).toBeVisible();

    expect(failures, `Uncaught page errors: ${failures.join(" | ")}`).toEqual([]);
  });

  test("the seeded member reaches the same workspace", async ({
    memberPage,
  }) => {
    await memberPage.goto(`/workspace/${e2eState.workspace.slugId}`);

    await expect(
      memberPage.getByRole("heading", { name: "E2E Workspace", level: 1 }),
    ).toBeVisible();
  });
});
