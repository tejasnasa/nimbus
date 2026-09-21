import { resolve } from "node:path";
import { test, expect, e2eState } from "./fixtures";

/**
 * Account settings page flows against the real two-process stack.
 *
 * The component tests in `apps/web/tests/components/AccountSettings.test.tsx`
 * cover the panel shapes; this spec is the integration companion — it pins
 * that the tab navigation, the form submission, and the navbar reflection
 * work end to end with the seeded user, the real API, and a real browser.
 *
 * Three flows, one each for the tabs the plan calls out:
 *
 * 1. **Profile rename** is visible in the navbar after a save (the navbar
 *    reads from a server component, so this also pins that the save triggers
 *    a server refresh rather than leaving the UI stale).
 * 2. **Active sessions** lists the seeded single session, marks the current
 *    device, and disables its revoke button.
 * 3. **Change password** submits through the form and is then signed out
 *    from other devices (the `revokeOtherSessions` checkbox on by default).
 *
 * Two E2E rules from the plan (§10.1) shaped the boundaries:
 *
 * - **No real Cloudinary upload.** The avatar upload is exercised by the
 *   component and hook tests; here we assert only that the form's *rename*
 *   half works.
 * - **No delete-account against shared fixtures.** The cascade is a
 *   server-side property, fully covered by Phase 1 integration tests. The
 *   Danger Zone panel is therefore not asserted end to end.
 *
 * Read every id from the seed inside a `beforeEach` or a fixture — never at
 * module scope — so a re-seed does not produce a hard-coded mismatch.
 */

test.describe("settings", () => {
  test("the rename is visible in the navbar after saving", async ({ page }) => {
    const newName = `Ada Lovelace ${Date.now()}`;

    await page.goto("/settings");

    // The Profile tab is the default — no click needed.
    const profileForm = page.getByLabel("profile-settings-form");
    await expect(profileForm).toBeVisible();

    const nameField = profileForm.getByLabel("Display name");
    await nameField.fill(newName);

    const saveButton = profileForm.getByRole("button", {
      name: "Save Changes",
    });

    // The button is `disabled={!isDirty || isSubmitting}`. It starts
    // disabled (clean form), becomes enabled once we edit, and cycles back
    // to disabled after the save completes. Watching the post-edit enable
    // pins that the form is actually dirty — without it, the click below
    // would be a no-op and the navbar check below would pass against the
    // *original* seeded name.
    await expect(saveButton).toBeEnabled();

    // Watch the mutation hit the wire — this is the closest assertion that
    // `updateUser` was actually called with the typed name, regardless of
    // how the navbar subsequently re-renders.
    const updateResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/auth/update-user") &&
        response.request().method() === "POST",
    );
    await saveButton.click();
    const response = await updateResponse;
    expect(response.status()).toBe(200);

    // After the mutation, the form re-syncs with the server-rendered
    // values, so the button disables again — this is the closest observable
    // signal that the form was reset.
    await expect(saveButton).toBeDisabled();

    // `/settings` is a server component, so the rename does not propagate
    // to the navbar until `router.refresh()` re-renders. Force a fresh
    // navigation so the navbar is rebuilt from the new session rather than
    // from any client-side cached value.
    await page.goto("/settings");

    // The navbar avatar's `alt` text carries the user's name, so a fresh
    // load that finds the new name proves the session reflects the
    // mutation. The `OptionMenu` items live inside a closed dropdown, so
    // asserting on the avatar's alt is the cheapest surface that proves
    // the navbar was re-rendered. Scope to the navigation to disambiguate
    // from the form panel's own avatar (which also carries the same alt).
    await expect(
      page.getByRole("navigation").getByAltText(newName),
    ).toBeVisible();
  });

  test("the active sessions tab lists the seeded session and marks the current device", async ({
    page,
  }) => {
    await page.goto("/settings");

    // Switch to the Sessions tab — the label is the button text rendered by
    // `SettingTabs`.
    await page.getByRole("button", { name: "Sessions", exact: true }).click();

    const panel = page.getByLabel("active-sessions");
    await expect(panel).toBeVisible();

    // Exactly one session row for the seeded user, and the row carries the
    // "current device" marker. The seeded session has no other devices, so
    // the bulk-revoke control is not rendered at all.
    const rows = panel.getByTestId("session-row");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveAttribute("data-current", "true");
    await expect(panel.getByText("This device")).toBeVisible();

    // The current row's revoke button is disabled — revoking your own session
    // from the list is a confusing way to sign out, so the UI blocks it.
    const revokeCurrent = panel.getByRole("button", { name: /Sign out of/i });
    await expect(revokeCurrent.first()).toBeDisabled();
  });

  test("the password tab submits a new password through the form", async ({
    page,
  }) => {
    // The form lives behind a credential probe, so we wait for it to settle
    // before asserting on its inputs.
    await page.goto("/settings");
    await page.getByRole("button", { name: "Password", exact: true }).click();

    const form = page.getByLabel("change-password-form");
    await expect(form).toBeVisible();

    await form.getByLabel("Current password").fill(e2eState.password);
    await form
      .getByLabel("New password", { exact: true })
      .fill("Brand-New-Password-987!");
    await form
      .getByLabel("Confirm new password")
      .fill("Brand-New-Password-987!");

    // Watch the mutation hit the wire — pins that the form really submitted
    // with the right shape (current + new + revokeOtherSessions) rather than
    // than silently failing on a client-side validation.
    const changeResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/auth/change-password") &&
        response.request().method() === "POST",
    );
    // Leave the revoke-other-sessions checkbox at its default (true).
    await form.getByRole("button", { name: "Change password" }).click();
    const response = await changeResponse;
    expect(response.status()).toBe(200);

    // The form stays mounted after a successful change (the hook does not
    // navigate). The Password tab is still the active one and the form
    // remains visible — the only thing a successful response changes is
    // the hook's internal `done` flag.
    await expect(form).toBeVisible();
    await expect(page).toHaveURL(/\/settings$/);

    // `revokeOtherSessions: true` (the default the UI ships with) wiped the
    // owner's only session and minted a fresh one. The cookie the
    // `setup` project's storageState captured at boot is now stale, and
    // every test that loads `.auth/owner.json` afterwards would land on a
    // 401 from `/api/workspace`. Restore the seeded password *and* write
    // the live cookie back to the on-disk storage state so the next spec's
    // context opens with a valid session. `playwright`'s storageState path
    // is the same one `auth.setup.ts` uses, so the override is sticky.
    await form.getByLabel("Current password").fill("Brand-New-Password-987!");
    await form
      .getByLabel("New password", { exact: true })
      .fill(e2eState.password);
    await form.getByLabel("Confirm new password").fill(e2eState.password);

    const restoreResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/auth/change-password") &&
        response.request().method() === "POST",
    );
    await form.getByRole("button", { name: "Change password" }).click();
    expect((await restoreResponse).status()).toBe(200);

    // The browser context now carries a fresh, valid session cookie. Save
    // it back to the same file `auth.setup.ts` writes — subsequent tests
    // load that file into their contexts and start with the right session.
    await page.context().storageState({
      path: resolve(import.meta.dirname, ".auth/owner.json"),
    });
  });
});
