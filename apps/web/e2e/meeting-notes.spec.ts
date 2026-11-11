import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { test, expect, e2eState } from "./fixtures";

/**
 * Meeting notes, end to end.
 *
 * A meeting with a four-line transcript is stored directly (a call normally
 * needs a media room, an agent and real audio; `seed_e2e_meeting.ts` writes the
 * result instead), then ended through the real stop route. From there everything
 * is the production path: the API queues the notes, asks the model, validates
 * the answer, writes the decisions, action items and the notes document in one
 * transaction, and announces it over Socket.IO.
 *
 * The model is the local fake provider (`fake-provider.mjs`, reached through
 * `AI_TEST_BASE_URL`, honoured only under `NODE_ENV=test`): it recognises the
 * notes instructions and answers with fixed, valid notes whose action items name
 * the two seeded users. The workspace has no key of its own, so the call is
 * served by the free tier, which the fake accepts like any other token.
 *
 * What the page then has to show:
 *   - NimbusBot's chat message with a link to the notes document, and a tab for
 *     that document, both arriving live (the page is never reloaded);
 *   - the link opening the notes in the editor;
 *   - the call card's "Open meetings" shortcut landing on the Meetings tab, with
 *     the meeting listed as "Notes ready" under the title the notes gave it;
 *   - the action items, filtered to the owner's own and then to everyone's, with
 *     the owner and due date the notes named, and one that can be checked off;
 *   - the meeting's detail (summary, decision, transcript) and deleting it from
 *     there, which leaves the settings dialog open on the list.
 *
 * The seeded workspace is shared with the other specs, so everything this
 * creates (the meeting, the notes document, the action items) is removed after
 * the test, even when an assertion fails or the test times out.
 */

const room = `/workspace/${e2eState.workspace.slugId}`;
const API = "http://localhost:3001";
const apiDir = resolve(import.meta.dirname, "../../api");

/** Stores the live meeting and its transcript; returns the meeting's id. */
function seedLiveMeeting(): string {
  const output = execSync(
    `npx tsx scripts/seed_e2e_meeting.ts ${e2eState.workspace.id} ${e2eState.users.owner.id} ${e2eState.users.member.id}`,
    {
      cwd: apiDir,
      encoding: "utf8",
      env: { ...process.env, REDIS_TLS: "false" },
    },
  );
  const last = output.trim().split("\n").pop() ?? "";
  return (JSON.parse(last) as { meetingId: string }).meetingId;
}

test.describe("meeting notes", () => {
  let meetingId: string | null = null;

  // A hook rather than `finally`: after a test times out its page is closed,
  // but hooks still get their own time with the fixtures alive, so a failure
  // here can never leave a live meeting behind for the specs that follow.
  test.afterEach(async ({ page }) => {
    if (meetingId) await cleanUp(page, meetingId);
    meetingId = null;
  });

  test("ending a meeting writes notes, a notes tab and action items", async ({
    page,
  }) => {
    // Notes are queued a few seconds after the meeting ends, then a model call
    // and a transaction follow, before the rest of the walk-through runs.
    test.setTimeout(120_000);
    const id = seedLiveMeeting();
    meetingId = id;
    const notesTitle = /^Meeting notes: E2E launch sync \(\d{4}-\d{2}-\d{2}\)$/;

    await page.goto(room);

    // Typing before the composer hydrates is lost (React resets the field and
    // Send stays disabled), so type until Send is enabled.
    const composer = page.getByPlaceholder("Type a message...");
    const send = page.getByRole("button", { name: "Send" });
    await expect(async () => {
      await composer.fill("Wrapping up");
      await expect(send).toBeEnabled({ timeout: 1_000 });
    }).toPass({ timeout: 30_000 });

    // A message that comes back over the socket proves the page is connected
    // and in the workspace room, which the notes announcements need.
    await send.click();
    await expect(page.getByText("Wrapping up", { exact: true })).toBeVisible();

    // Ending the meeting is what queues the notes; the model is called a few
    // seconds later.
    const stop = await page.request.post(
      `${API}/api/meetings/${id}/assistant/stop`,
    );
    expect(stop.ok()).toBe(true);

    // NimbusBot announces the notes in chat with a link to the document, and
    // the document appears as a tab, both without a reload.
    const link = page.getByTestId("chat-doc-link");
    await expect(link).toHaveText(notesTitle, { timeout: 60_000 });
    await expect(
      page.getByText("Notes from the call are ready: E2E launch sync."),
    ).toBeVisible();
    const notesTab = page
      .locator('div[draggable="true"]')
      .filter({ hasText: "Meeting notes: E2E launch sync" });
    await expect(notesTab).toBeVisible();

    // The link opens the notes in the editor.
    await link.click();
    await expect(page.locator(".milkdown").first()).toContainText(
      "The team agreed to ship the launch on Friday",
      { timeout: 30_000 },
    );

    // The call card's shortcut opens the settings on the Meetings tab.
    await page.getByTestId("voice-dock-toggle").click();
    await page.getByRole("button", { name: "Open meetings" }).click();
    const panel = page.getByTestId("workspace-meetings-panel");
    await expect(panel).toBeVisible();
    const row = panel.getByTestId(`meeting-row-${id}`);
    await expect(row).toContainText("E2E launch sync");
    await expect(row).toContainText("Notes ready");

    // Action items: the owner's own first, then everyone's.
    await panel.getByRole("button", { name: "Action items" }).click();
    const items = panel.locator('[data-testid^="action-item-"]');
    const rollback = items.filter({ hasText: "Write the rollback plan" });
    const changelog = items.filter({ hasText: "Update the changelog" });
    await expect(rollback).toBeVisible();
    await expect(changelog).toHaveCount(0);

    await panel.getByRole("button", { name: "All", exact: true }).click();
    await expect(changelog).toBeVisible();
    await expect(rollback).toBeVisible();
    await expect(changelog.getByRole("combobox")).toContainText("E2E Member");
    await expect(changelog.getByLabel("Due date", { exact: true })).toHaveValue(
      "2026-12-04",
    );

    // Checking one off is saved. A plain click, not `check()`: the box is
    // controlled and only flips once the server has answered, which `check()`
    // would report as the click having had no effect.
    await rollback
      .getByRole("checkbox", { name: 'Mark "Write the rollback plan" done' })
      .click();
    await expect(rollback).toHaveAttribute("data-status", "DONE");
    const done = await page.request.get(
      `${API}/api/action-items?workspaceId=${e2eState.workspace.id}&status=done`,
    );
    const doneItems = (await done.json()).responseObject.items as Array<{
      text: string;
    }>;
    expect(doneItems.map((item) => item.text)).toEqual([
      "Write the rollback plan",
    ]);

    // The meeting's detail: notes and transcript.
    await panel.getByRole("button", { name: "Meetings", exact: true }).click();
    await row.getByRole("button").click();
    const detail = panel.getByTestId("meeting-detail");
    await expect(detail).toContainText(
      "The team agreed to ship the launch on Friday",
    );
    await expect(detail).toContainText("Ship the launch on Friday");
    await expect(panel.getByTestId("transcript-lines")).toContainText(
      "E2E Member: Agreed, I will update the changelog.",
    );

    // Deleting it returns to the list, with the settings still open.
    await panel.getByTestId("delete-meeting").click();
    await page.getByTestId("confirm-delete-meeting").click();
    await expect(panel.getByTestId("meetings-notice")).toContainText(
      "Meeting deleted.",
    );
    await expect(panel.getByTestId(`meeting-row-${id}`)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  });
});

/** Removes the meeting, its notes document and the action items it produced. */
async function cleanUp(
  page: import("@playwright/test").Page,
  meetingId: string,
) {
  const workspaceId = e2eState.workspace.id;

  // A live meeting cannot be deleted; ending one that has already ended is a
  // harmless no-op.
  await page.request.post(`${API}/api/meetings/${meetingId}/assistant/stop`);

  const items = await page.request.get(
    `${API}/api/action-items?workspaceId=${workspaceId}&status=all&limit=100`,
  );
  if (items.ok()) {
    const list = (await items.json()).responseObject.items as Array<{
      id: string;
    }>;
    for (const item of list) {
      await page.request.delete(`${API}/api/action-items/${item.id}`);
    }
  }

  const docs = await page.request.get(
    `${API}/api/document/workspace/${workspaceId}`,
  );
  if (docs.ok()) {
    const list = (await docs.json()).responseObject as Array<{
      id: string;
      title: string;
    }>;
    for (const doc of list.filter((d) =>
      d.title.startsWith("Meeting notes:"),
    )) {
      await page.request.delete(`${API}/api/document/${doc.id}`);
    }
  }

  // Already gone when the test got as far as deleting it.
  await page.request.delete(`${API}/api/meetings/${meetingId}`);
}
