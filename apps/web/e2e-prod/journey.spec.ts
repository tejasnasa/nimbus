import type { Page } from "@playwright/test";
import { test as fixturesTest, expect } from "./fixtures";
import { apiUrl, AUTH_DIR, SMOKE_WORKSPACE_PREFIX } from "./env";

/**
 * The critical path, driven against production as a signed-in user.
 *
 * @important The workspace under test is owned by a worker-scoped fixture that
 *            creates it over the API and deletes it in teardown — which runs on
 *            failure too, so a crash mid-journey does not leave an orphan for the
 *            next night's sweep. It is deliberately not created in a
 *            `beforeAll`, and the suite runs with `retries: 0`: retrying a
 *            mutation-heavy journey against production would create a second
 *            workspace, post a second round of messages and bill a second model
 *            call, while `beforeAll` does not re-run on retry anyway.
 *
 * @important The tests below are a sequence and share that workspace, so an
 *            early failure cascades. That is the honest shape for a smoke test —
 *            the later steps genuinely cannot be reached — and each step still
 *            reports independently.
 */

/** A workspace created for this run, with everything later steps need. */
interface SmokeWorkspace {
  id: string;
  slugId: number;
  name: string;
}

/**
 * One workspace per worker, reaped when the worker finishes.
 *
 * `memberPage` is restated in the test-scoped type purely so TypeScript keeps
 * the inherited fixture in view; it is implemented once in `./fixtures`.
 */
const test = fixturesTest.extend<
  { memberPage: Page },
  { workspace: SmokeWorkspace }
>({
  workspace: [
    async ({ browser }, use) => {
      const context = await browser.newContext({
        storageState: `${AUTH_DIR}/owner.json`,
      });

      // Names are capped at 25 characters by the create schema, so the suffix is
      // base-36 rather than the full decimal timestamp.
      const name = `${SMOKE_WORKSPACE_PREFIX} ${Date.now().toString(36)}`;

      const created = await context.request.post(
        `${apiUrl}/api/workspace/create`,
        { data: { name, description: "Created by the production smoke suite." } },
      );

      expect(
        created.status(),
        "Workspace creation failed. A 500 here usually means BOT_USERID names " +
          "no real user on the droplet, which rolls back the whole transaction.",
      ).toBe(201);

      const body = await created.json();
      const workspace: SmokeWorkspace = {
        id: body.responseObject.workspaceId,
        slugId: body.responseObject.slugId,
        name,
      };

      try {
        await use(workspace);
      } finally {
        // `:wsid` is the cuid, not the numeric slugId the URL carries.
        await context.request.delete(
          `${apiUrl}/api/workspace/delete/${workspace.id}`,
        );
        await context.close();
      }
    },
    { scope: "worker" },
  ],
});

test.describe("journey", () => {
  test("creating a workspace through the dashboard seeds its documents", async ({
    context,
    page,
  }) => {
    const name = `${SMOKE_WORKSPACE_PREFIX} ui ${Date.now().toString(36)}`;

    await page.goto("/home");
    await page.getByRole("button", { name: "Create Workspace" }).click();
    await page.getByLabel("Title").fill(name);
    await page
      .getByLabel("Description")
      .fill("Created by the production smoke suite.");
    // `exact` matters: the trigger that opened this dialog also says "Create".
    await page.getByRole("button", { name: "Create", exact: true }).click();

    // The redirect is the signal that the whole transaction committed: the
    // workspace, the creator as OWNER, both seeded documents, and the NimbusBot
    // membership row. A failure anywhere in that chain leaves us on /home.
    await expect(page).toHaveURL(/\/workspace\/\d+$/);
    await expect(
      page.getByRole("heading", { name, level: 1 }),
    ).toBeVisible();
    await expect(page.getByText("New Canvas", { exact: true })).toBeVisible();
    await expect(page.getByText("New Document", { exact: true })).toBeVisible();

    // Cleaned up over the API rather than through the UI. The workspace settings
    // modal — the only route to the danger zone — is rendered by `VoiceControls`,
    // which returns a placeholder until the voice connection is up, and a
    // headless browser never gets a microphone. Asserting on that modal here
    // would pin the voice stack, not workspace deletion.
    const slugId = Number(page.url().match(/\/workspace\/(\d+)$/)![1]);
    const listed = await context.request.get(`${apiUrl}/api/workspace/`);
    const created = (await listed.json()).responseObject.find(
      (candidate: { slugId: number }) => candidate.slugId === slugId,
    );
    expect(
      created,
      "the workspace just created is missing from the owner's list",
    ).toBeTruthy();

    const deleted = await context.request.delete(
      `${apiUrl}/api/workspace/delete/${created.id}`,
    );
    expect(deleted.status()).toBe(200);
  });

  test("the workspace renders both documents creation seeds", async ({
    page,
    workspace,
  }) => {
    await page.goto(`/workspace/${workspace.slugId}`);

    await expect(
      page.getByRole("heading", { name: workspace.name, level: 1 }),
    ).toBeVisible();
    await expect(page.getByText("New Canvas", { exact: true })).toBeVisible();
    await expect(page.getByText("New Document", { exact: true })).toBeVisible();
    // One of the two editors must actually mount, not just its tab.
    await expect(page.locator(".excalidraw, .milkdown").first()).toBeVisible();
  });

  test("an edit to the markdown document survives a reload", async ({
    page,
    workspace,
  }) => {
    await page.goto(`/workspace/${workspace.slugId}`);
    await page.getByText("New Document", { exact: true }).click();

    // `.milkdown` is only the outer wrapper; clicking it does not focus the
    // ProseMirror surface, so the typed text goes nowhere. Target the editable
    // element itself.
    const editor = page.locator(".milkdown [contenteditable='true']").first();
    await expect(editor).toBeVisible();

    const marker = `smoke-${Date.now().toString(36)}`;

    // @important Retried as a unit. Milkdown attaches its ProseMirror view
    //            asynchronously, so the editable element can be in the DOM and
    //            focusable while keystrokes are still dropped — which presents
    //            as an editor that silently swallows everything typed into it.
    //            Re-running the click-and-type until the text is actually
    //            present is what makes this deterministic.
    await expect(async () => {
      await editor.click();
      await editor.pressSequentially(marker, { delay: 10 });
      await expect(editor).toContainText(marker, { timeout: 2_000 });
    }).toPass({ timeout: 30_000 });

    // The server persists Yjs state on a 5s debounce with no acknowledgement
    // event, so there is nothing to wait on. Reloading also flushes a snapshot
    // when the room drains, but waiting out the debounce first means the
    // assertion does not depend on that.
    await page.waitForTimeout(6_500);

    await page.reload();
    await page.getByText("New Document", { exact: true }).click();

    await expect(
      page.locator(".milkdown [contenteditable='true']").first(),
    ).toContainText(marker);
  });

  test("a chat message is delivered and persisted", async ({
    page,
    workspace,
  }) => {
    const content = `smoke message ${Date.now().toString(36)}`;

    await page.goto(`/workspace/${workspace.slugId}`);

    // Waits for the socket to be in the room, so a send cannot race the join.
    await expect(
      page.getByText("Ask anything from @NimbusBot"),
      "the chat composer is disabled — check /api/ai/status and the operator AI_API_KEY",
    ).toBeVisible();

    await page.getByPlaceholder("Type a message...").fill(content);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(content)).toBeVisible();

    // Surviving a reload is what proves it reached Postgres rather than only the
    // sending client.
    await page.reload();
    await expect(page.getByText(content)).toBeVisible();
  });

  test("an invited member joins the workspace", async ({
    context,
    workspace,
    memberPage,
  }) => {
    // Read over the API rather than the DOM: the Permissions tab exposes the
    // code only through a copy-to-clipboard button.
    const listed = await context.request.get(`${apiUrl}/api/workspace/`);
    const body = await listed.json();
    const record = body.responseObject.find(
      (candidate: { id: string }) => candidate.id === workspace.id,
    );
    expect(record?.inviteCode, "workspace missing from the owner's list").toBeTruthy();

    await memberPage.goto("/home");
    await memberPage
      .getByRole("button", { name: "or join with invite code" })
      .click();
    await memberPage
      .getByPlaceholder("Paste invite code here")
      .fill(record.inviteCode);
    // `exact` matters: the trigger that opened this dialog also says "join".
    await memberPage.getByRole("button", { name: "Join", exact: true }).click();

    await expect(memberPage).toHaveURL(`/workspace/${workspace.slugId}`);
    await expect(
      memberPage.getByText("New Document", { exact: true }),
    ).toBeVisible();

    // The member belongs to the workspace but does not own it, so the dashboard
    // ownership filter must exclude it — the one workspace-level distinction the
    // UI actually enforces.
    await memberPage.goto("/home");
    await memberPage.getByRole("button", { name: "My Workspaces" }).click();
    await expect(memberPage.locator(`[id="${workspace.slugId}"]`)).toHaveCount(0);
  });

  test("the owner's message reaches the member live", async ({
    page,
    memberPage,
    workspace,
  }) => {
    const content = `live smoke ${Date.now().toString(36)}`;

    await page.goto(`/workspace/${workspace.slugId}`);
    await memberPage.goto(`/workspace/${workspace.slugId}`);

    // Both sockets must be in the room before the send, or the broadcast has
    // nobody to reach and this would flake rather than fail.
    await expect(
      page.getByText("Ask anything from @NimbusBot"),
      "the chat composer is disabled — check /api/ai/status and the operator AI_API_KEY",
    ).toBeVisible();
    await expect(
      memberPage.getByText("Ask anything from @NimbusBot"),
      "the member's chat composer is disabled — check /api/ai/status",
    ).toBeVisible();

    await page.getByPlaceholder("Type a message...").fill(content);
    await page.getByRole("button", { name: "Send" }).click();

    await expect(page.getByText(content)).toBeVisible();
    await expect(memberPage.getByText(content)).toBeVisible();
  });

  test("NimbusBot replies in chat without generating a document", async ({
    page,
    workspace,
  }) => {
    test.skip(
      process.env.SMOKE_SKIP_AI === "1",
      "AI check skipped for this run",
    );
    // The model call dominates this test; the config default is too tight.
    test.setTimeout(180_000);

    await page.goto(`/workspace/${workspace.slugId}`);
    await expect(
      page.getByText("Ask anything from @NimbusBot"),
      "the chat composer is disabled — check /api/ai/status and the operator AI_API_KEY",
    ).toBeVisible();

    // A prompt the only sensible answer to is text, so the bot has no reason to
    // reach for `create_document`. That path is metered, and this suite must
    // never touch it.
    await page
      .getByPlaceholder("Type a message...")
      .fill("@NimbusBot reply with exactly the token SMOKE_OK and nothing else");
    await page.getByRole("button", { name: "Send" }).click();

    const reply = page.getByText(/SMOKE_OK/);
    // A refusal posts no chat message at all, so without racing it the failure
    // would be an opaque timeout. This is the banner the panel raises on
    // `ai:refused`.
    //
    // @important Scoped to `main`. Next.js renders a route announcer —
    //            `<next-route-announcer><p role="alert">` — as a sibling of
    //            `main`, and an unscoped `getByRole("alert")` matches it
    //            immediately, reading as a refusal with empty text on a page
    //            where the bot answered perfectly well.
    const refusal = page.locator("main").getByRole("alert");

    const outcome = await Promise.race([
      reply
        .waitFor({ state: "visible", timeout: 60_000 })
        .then(() => "reply" as const)
        .catch(() => null),
      refusal
        .waitFor({ state: "visible", timeout: 60_000 })
        .then(() => "refusal" as const)
        .catch(() => null),
    ]);

    if (outcome === "refusal") {
      throw new Error(
        `NimbusBot refused the request: ${(await refusal.textContent())?.trim()}`,
      );
    }

    // Asserted positively, not by excluding the fallback strings: `lib/bot.ts`
    // never throws, so a degraded reply would satisfy any "is not the fallback"
    // check, and so would the "I am creating the document" announcement.
    expect(
      outcome,
      "NimbusBot did not answer within 60s — check the provider key and quota",
    ).toBe("reply");

    // Belt and braces: if the model had called the tool, the posted message
    // would be the announcement and the assertion above would already have
    // failed — this names the cause.
    await expect(page.getByText(/creating the document/i)).toHaveCount(0);
  });

  test("the owner cannot be demoted or removed", async ({
    context,
    workspace,
  }) => {
    const listed = await context.request.get(`${apiUrl}/api/workspace/`);
    const body = await listed.json();
    const record = body.responseObject.find(
      (candidate: { id: string }) => candidate.id === workspace.id,
    );
    const owner = record.members.find(
      (member: { role: string }) => member.role === "OWNER",
    );
    expect(owner, "no OWNER row on the smoke workspace").toBeTruthy();

    // Asserted against the controller rather than the settings UI: the role menu
    // does not clearly disable itself, and a toast is a brittle thing to pin.
    const demote = await context.request.put(
      `${apiUrl}/api/workspace/role/${workspace.id}`,
      { data: { memberId: owner.id, role: "MEMBER" } },
    );
    expect(demote.status()).toBe(403);

    const remove = await context.request.delete(
      `${apiUrl}/api/workspace/leave/${workspace.id}`,
      { data: { memberId: owner.id } },
    );
    expect(remove.status()).toBe(403);
  });

  test("removing the member revokes their access", async ({
    context,
    memberPage,
    workspace,
  }) => {
    const listed = await context.request.get(`${apiUrl}/api/workspace/`);
    const record = (await listed.json()).responseObject.find(
      (candidate: { id: string }) => candidate.id === workspace.id,
    );
    expect(
      record,
      "the smoke workspace is missing from the owner's list",
    ).toBeTruthy();

    // Membership is ensured here rather than assumed from the join test. That
    // test is about the invite flow; this one is about revocation, and should
    // still assert something real when the join test failed. A 400 ("already a
    // member") on a rerun is expected and harmless.
    await memberPage.context().request.post(`${apiUrl}/api/workspace/join`, {
      data: { inviteCode: record.inviteCode },
    });

    const refreshed = (
      await (await context.request.get(`${apiUrl}/api/workspace/`)).json()
    ).responseObject.find(
      (candidate: { id: string }) => candidate.id === workspace.id,
    );

    const member = refreshed.members.find(
      (candidate: { role: string }) => candidate.role === "MEMBER",
    );
    expect(
      member,
      // Naming the roles actually present turns a bare "undefined" into a
      // diagnosis on the next nightly.
      `no MEMBER on the workspace; roles present: ${refreshed.members
        .map((entry: { role: string }) => entry.role)
        .join(", ")}`,
    ).toBeTruthy();

    const removed = await context.request.delete(
      `${apiUrl}/api/workspace/leave/${workspace.id}`,
      { data: { memberId: member.id } },
    );
    expect(removed.status()).toBe(200);

    // The API is the deterministic check.
    const revoked = await memberPage
      .context()
      .request.get(`${apiUrl}/api/workspace/${workspace.slugId}`);
    expect(revoked.status()).toBe(404);

    // Reload before asserting on the page: removal does not disconnect the
    // member's socket or evict them from the room, so an already-open page keeps
    // rendering until it re-fetches.
    await memberPage.reload();

    // Assert the workspace content is gone rather than that one particular
    // not-found screen rendered. The route keeps its URL and resolves to
    // `not-found.tsx` in place, but a removed member reloading can land on a
    // blank shell instead of that screen — observable, but a rendering detail
    // this test has no business pinning. Revocation itself is already proven
    // deterministically by the 404 above.
    await expect(
      memberPage.getByText("New Document", { exact: true }),
    ).toHaveCount(0);
  });
});
