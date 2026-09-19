import { test, expect, e2eState } from "./fixtures";

/**
 * The tabbed document surface.
 *
 * `DocEditor` mounts exactly one editor at a time behind `DocTabs`, and the two
 * editor types pull in very different machinery (Excalidraw vs Milkdown + Yjs).
 * These specs pin the mount/unmount contract between them.
 */

const room = `/workspace/${e2eState.workspace.slugId}`;

test.describe("documents", () => {
  test("both seeded documents are present as tabs", async ({ page }) => {
    await page.goto(room);

    await expect(page.getByText("E2E Canvas")).toBeVisible();
    await expect(page.getByText("E2E Document")).toBeVisible();
  });

  test("selecting a tab swaps the mounted editor", async ({ page }) => {
    await page.goto(room);

    // The seeded canvas is seeded first, so it is the active tab on load.
    await expect(page.locator(".excalidraw")).toBeVisible();

    await page.getByText("E2E Document").click();
    // `.milkdown` matches both the app's wrapper and Milkdown's own root, so this
    // is deliberately `first()` rather than a strict single-element match.
    await expect(page.locator(".milkdown").first()).toBeVisible();

    // The canvas must be unmounted, not merely hidden: `DocEditor` keys each
    // editor by document id, so leaving both mounted would keep two live
    // socket-synced editors on one page.
    await expect(page.locator(".excalidraw")).toHaveCount(0);

    await page.getByText("E2E Canvas").click();
    await expect(page.locator(".excalidraw")).toBeVisible();
    await expect(page.locator(".milkdown")).toHaveCount(0);
  });

  test("a member sees the same document set as the owner", async ({
    memberPage,
  }) => {
    await memberPage.goto(room);

    await expect(memberPage.getByText("E2E Canvas")).toBeVisible();
    await expect(memberPage.getByText("E2E Document")).toBeVisible();
  });
});
