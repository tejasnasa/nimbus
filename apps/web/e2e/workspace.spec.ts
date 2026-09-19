import { test, expect, e2eState } from "./fixtures";

/**
 * The dashboard and the two workspace entry flows.
 *
 * Creation is worth driving end to end: it runs a single Prisma transaction that
 * adds the creator as OWNER, seeds a CANVAS and a MARKDOWN document, and inserts
 * NimbusBot as an ADMIN member. A failure anywhere in that chain surfaces here as
 * a 500 instead of a room.
 */

test.describe("workspace", () => {
  test("the dashboard lists the workspace and both entry flows", async ({
    page,
  }) => {
    await page.goto("/home");

    await expect(page.locator(`[id="${e2eState.workspace.slugId}"]`)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create Workspace" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "or join with invite code" }),
    ).toBeVisible();
  });

  test("the My Workspaces filter is scoped to workspaces you own", async ({
    page,
    memberPage,
  }) => {
    // The owner created the seeded workspace, so it survives the filter…
    await page.goto("/home");
    await page.getByRole("button", { name: "My Workspaces" }).click();
    await expect(page.locator(`[id="${e2eState.workspace.slugId}"]`)).toBeVisible();

    // …while the member only belongs to it, so it does not.
    await memberPage.goto("/home");
    await memberPage.getByRole("button", { name: "My Workspaces" }).click();
    await expect(memberPage.locator(`[id="${e2eState.workspace.slugId}"]`)).toHaveCount(
      0,
    );
  });

  test("creating a workspace opens its room with both seeded documents", async ({
    page,
  }) => {
    await page.goto("/home");

    await page.getByRole("button", { name: "Create Workspace" }).click();
    await page.getByLabel("Title").fill("E2E Created Workspace");
    await page.getByLabel("Description").fill("Created by the end-to-end suite.");
    // `exact` matters: the "Create Workspace" trigger that opened this dialog
    // also contains "Create".
    await page.getByRole("button", { name: "Create", exact: true }).click();

    // `useWorkspaceForm` routes to the new room on success; a 500 from the
    // creation transaction leaves us on `/home` with a root form error.
    await expect(page).toHaveURL(/\/workspace\/\d+$/);
    await expect(
      page.getByRole("heading", { name: "E2E Created Workspace", level: 1 }),
    ).toBeVisible();

    // The transaction seeds exactly one canvas and one markdown document, and
    // both arrive as tabs. Which one is active depends on the order the API
    // returns them, so this asserts the pair rather than picking a tab.
    await expect(page.getByText("New Canvas", { exact: true })).toBeVisible();
    await expect(page.getByText("New Document", { exact: true })).toBeVisible();
    await expect(page.locator(".excalidraw, .milkdown").first()).toBeVisible();
  });

  test("an unknown invite code is rejected with a form error", async ({
    page,
  }) => {
    await page.goto("/home");

    await page.getByRole("button", { name: "or join with invite code" }).click();
    await page.getByPlaceholder("Paste invite code here").fill("NOT-A-REAL-CODE");
    // `exact` matters: the trigger that opened this dialog also contains "join".
    await page.getByRole("button", { name: "Join", exact: true }).click();

    await expect(page).toHaveURL(/\/home$/);
    await expect(page.getByText(/invalid|not found|invite/i).first()).toBeVisible();
  });
});
