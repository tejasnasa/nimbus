import { test, expect, e2eState } from "./fixtures";
import { resolve } from "node:path";

/**
 * A real call between two browsers.
 *
 * Both contexts connect to the LiveKit dev server from `docker-compose.test.yml`
 * through the API's own token route, with Chromium's fake audio device standing
 * in for a microphone, so the whole path is exercised: token, signalling,
 * WebRTC, and the room events the UI renders from. The webhook roster is not
 * asserted here (the dev server has no webhook target); the API suite covers it.
 *
 * @important Needs the `livekit-test` service to be up (`make test-infra-up`).
 */

const room = `/workspace/${e2eState.workspace.slugId}`;

test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
});

test.describe("voice call", () => {
  test("two people join, see each other, and each other's mute state", async ({
    browser,
  }) => {
    const open = async (who: "owner" | "member") => {
      const context = await browser.newContext({
        storageState: resolve(import.meta.dirname, `.auth/${who}.json`),
        permissions: ["microphone"],
      });
      const page = await context.newPage();
      await page.goto(room);
      return { context, page };
    };

    const owner = await open("owner");
    const member = await open("member");

    try {
      await expect(owner.page.getByRole("button", { name: "Join call" })).toBeVisible();
      await expect(member.page.getByRole("button", { name: "Join call" })).toBeVisible();

      await owner.page.getByRole("button", { name: "Join call" }).click();
      await member.page.getByRole("button", { name: "Join call" }).click();

      // Each sees both people, and the Join button has become the call controls.
      for (const { page } of [owner, member]) {
        await expect(page.getByTestId("call-participant")).toHaveCount(2, {
          timeout: 30_000,
        });
        await expect(page.getByRole("button", { name: "Leave call" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Join call" })).toHaveCount(0);
      }

      // Everyone joins muted.
      for (const { page } of [owner, member]) {
        await expect(page.locator('[data-testid="call-participant"][data-muted="false"]')).toHaveCount(0);
      }

      // The member unmutes: the owner's view of the member changes.
      await member.page.getByRole("button", { name: "Unmute Microphone" }).click();
      await expect(
        member.page.getByRole("button", { name: "Mute Microphone" }),
      ).toBeVisible();
      await expect(
        owner.page.locator('[data-testid="call-participant"][data-muted="false"]'),
      ).toHaveCount(1);

      // And back.
      await member.page.getByRole("button", { name: "Mute Microphone" }).click();
      await expect(
        owner.page.locator('[data-testid="call-participant"][data-muted="false"]'),
      ).toHaveCount(0);

      // The member leaves: the owner is alone on the call, and the member can
      // join again.
      await member.page.getByRole("button", { name: "Leave call" }).click();
      await expect(owner.page.getByTestId("call-participant")).toHaveCount(1);
      await expect(member.page.getByRole("button", { name: "Join call" })).toBeVisible();
    } finally {
      await owner.context.close();
      await member.context.close();
    }
  });
});
