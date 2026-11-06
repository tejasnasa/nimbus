import { test, expect, e2eState } from "./fixtures";

/**
 * The workspace AI settings, end to end.
 *
 * Keys belong to the workspace, so the interesting facts are about who sees
 * what: an admin adds a key and sees it listed with the model kinds that were
 * verified for it, and a plain member sees a read-only summary with no key
 * controls and no Usage tab.
 *
 * The API in this suite is started with `AI_TEST_BASE_URL` pointing at a local
 * fake provider (`fake-provider.mjs`), which the API honours only under
 * `NODE_ENV=test`. No real provider is called and no real key is used. The fake
 * rejects any token containing `rejected` (like a wrong key) and answers the
 * audio endpoints with 403 for a token containing `no-audio`, which is how the
 * "saved, but some kinds could not be verified" path is driven.
 *
 * The seeded workspace is shared with the other specs, so the owner test removes
 * every key it adds before it ends.
 */

const room = `/workspace/${e2eState.workspace.slugId}`;

/** Opens the workspace settings dialog from the voice header's gear. */
async function openSettings(page: import("@playwright/test").Page) {
  await page.goto(room);
  await page.getByTitle("Workspace settings").click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
}

/** Fills and submits the Add API key dialog for OpenAI. */
async function addOpenAiKey(
  page: import("@playwright/test").Page,
  apiKey: string,
) {
  await page.getByTestId("ai-add-key").click();
  const form = page.getByLabel("add-api-key-form");
  await expect(form).toBeVisible();
  await form.getByTestId("api-key-input").fill(apiKey);
  await form.getByTestId("api-key-save").click();
}

test.describe("workspace AI settings", () => {
  test("an owner adds a key, sees what it was verified for, and removes it", async ({
    page,
  }) => {
    await openSettings(page);
    await page.getByRole("button", { name: "AI", exact: true }).click();

    const panel = page.getByTestId("workspace-ai-panel");
    await expect(panel).toBeVisible();

    // A wrong key is refused with the provider's curated message and nothing is
    // stored.
    await addOpenAiKey(page, "sk-e2e-rejected-0001");
    await expect(page.getByTestId("api-key-error")).toContainText(
      "Incorrect API key",
    );
    await expect(page.getByTestId("ai-credential-row-openai")).toHaveCount(0);

    // A key whose audio probes fail is still stored, with a warning, and only
    // the kind that passed is listed. The dialog is still open after the
    // refusal, so the corrected key goes into the same form.
    const retry = page.getByLabel("add-api-key-form");
    await retry.getByTestId("api-key-input").fill("sk-e2e-no-audio-0002");
    await retry.getByTestId("api-key-save").click();
    await expect(page.getByTestId("ai-save-warnings")).toBeVisible();
    const row = page.getByTestId("ai-credential-row-openai");
    await expect(row).toBeVisible();
    await expect(page.getByTestId("ai-kind-openai-text")).toBeVisible();
    await expect(page.getByTestId("ai-kind-openai-transcription")).toHaveCount(0);

    // Replacing it with a key the fake accepts verifies every kind.
    await page.getByTestId("ai-replace-credential-openai").click();
    const form = page.getByLabel("add-api-key-form");
    await form.getByTestId("api-key-input").fill("sk-e2e-good-0003");
    await form.getByTestId("api-key-save").click();
    await expect(page.getByTestId("ai-kind-openai-transcription")).toBeVisible();
    await expect(page.getByTestId("ai-kind-openai-speech")).toBeVisible();

    // Only the masked preview is ever shown, never the key.
    await expect(panel).not.toContainText("sk-e2e-good-0003");
    await expect(panel).not.toContainText("sk-e2e-no-audio-0002");

    // The Usage tab is offered to an admin.
    await expect(page.getByRole("button", { name: "Usage", exact: true })).toBeVisible();

    // Clean up so the shared workspace is as the other specs expect it.
    await page.getByTestId("ai-remove-credential-openai").click();
    await expect(page.getByTestId("ai-credential-row-openai")).toHaveCount(0);
  });

  test("a spend cap saves and is shown back", async ({ page }) => {
    await openSettings(page);
    await page.getByRole("button", { name: "AI", exact: true }).click();

    const input = page.getByTestId("ai-spend-cap-input");
    await input.fill("12.5");
    await page.getByTestId("ai-spend-cap-save").click();
    await expect(page.getByTestId("ai-spend-cap-save")).toBeDisabled();
    await expect(input).toHaveValue("12.5");

    // Reload to prove it was stored rather than held in the form.
    await openSettings(page);
    await page.getByRole("button", { name: "AI", exact: true }).click();
    await expect(page.getByTestId("ai-spend-cap-input")).toHaveValue("12.5");

    // Leave no cap behind for the other specs.
    await page.getByTestId("ai-spend-cap-input").fill("");
    await page.getByTestId("ai-spend-cap-save").click();
    await expect(page.getByTestId("ai-spend-cap-save")).toBeDisabled();
  });

  test("a member sees a read-only summary, no key controls and no Usage tab", async ({
    memberPage,
  }) => {
    await openSettings(memberPage);

    await expect(
      memberPage.getByRole("button", { name: "Usage", exact: true }),
    ).toHaveCount(0);

    await memberPage.getByRole("button", { name: "AI", exact: true }).click();
    await expect(memberPage.getByTestId("ai-member-summary")).toBeVisible();
    await expect(memberPage.getByText(/managed by workspace admins/)).toBeVisible();
    await expect(memberPage.getByTestId("ai-add-key")).toHaveCount(0);
    await expect(memberPage.getByTestId("workspace-ai-panel")).toHaveCount(0);
  });

  test("a member cannot reach the admin routes directly", async ({
    memberPage,
  }) => {
    await memberPage.goto(room);
    const base = `http://localhost:3001/api/ai/workspaces/${e2eState.workspace.id}`;

    const credentials = await memberPage.request.get(`${base}/credentials`);
    expect(credentials.status()).toBe(403);
    const usage = await memberPage.request.get(`${base}/usage`);
    expect(usage.status()).toBe(403);
    const status = await memberPage.request.get(`${base}/status`);
    expect(status.status()).toBe(200);
  });

  test("the account settings page shows free usage instead of keys", async ({
    page,
  }) => {
    await page.goto("/settings");
    await page.getByRole("button", { name: "Free usage", exact: true }).click();

    await expect(page.getByTestId("free-usage-panel")).toBeVisible();
    await expect(page.getByTestId("free-docs")).toBeVisible();
    await expect(page.getByTestId("ai-add-key")).toHaveCount(0);
    // The owner administers the seeded workspace, so it is offered.
    await expect(
      page.getByTestId(`free-workspace-link-${e2eState.workspace.slugId}`),
    ).toBeVisible();
  });
});
