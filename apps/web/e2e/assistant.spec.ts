import { test, expect, e2eState } from "./fixtures";
import { resolve } from "node:path";

/**
 * The in-call assistant, end to end.
 *
 * A person joins the call with Chromium playing a recorded sentence in place of
 * a microphone, starts Nimbus, and watches a caption appear. Everything between
 * is real: the API dispatches the agent to the LiveKit dev server, the agent
 * redeems its ticket, hears the audio, cuts an utterance with the real voice
 * activity model, and posts it for transcription to the local fake provider
 * (`fake-provider.mjs`), which answers with a scripted sentence. The caption
 * the page shows travelled agent -> API -> Socket.IO -> browser.
 *
 * @important Needs the `livekit-test` service (`make test-infra-up`). The
 *            agent worker is started by `playwright.config.ts`; it is the
 *            development worker pointed at the dev media server, never at
 *            LiveKit Cloud.
 */

const room = `/workspace/${e2eState.workspace.slugId}`;

const SPEECH = resolve(
  import.meta.dirname,
  "../../agent/src/__tests__/fixtures/speech.wav",
);

test.use({
  permissions: ["microphone"],
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      `--use-file-for-fake-audio-capture=${SPEECH}`,
    ],
  },
});

test.describe("in-call assistant", () => {
  test("starts, captions what is said for everyone on the call, and stops", async ({
    page,
    memberPage,
  }) => {
    await page.goto(room);
    await memberPage.goto(room);

    // The assistant cannot be started from outside the call.
    await expect(page.getByRole("button", { name: "Start Nimbus" })).toHaveCount(0);

    await page.getByTestId("voice-dock-toggle").click();
    await memberPage.getByTestId("voice-dock-toggle").click();
    await page.getByRole("button", { name: "Join call" }).click();
    await memberPage.getByRole("button", { name: "Join call" }).click();
    await expect(page.getByTestId("call-participant")).toHaveCount(2, {
      timeout: 30_000,
    });

    // The owner starts speaking, then starts Nimbus.
    await page.getByRole("button", { name: "Unmute Microphone" }).click();
    await page.getByRole("button", { name: "Start Nimbus" }).click();

    for (const view of [page, memberPage]) {
      await expect(view.getByTestId("captions")).toContainText(
        "Nimbus launch plan",
        { timeout: 45_000 },
      );
    }
    await expect(page.getByTestId("caption-line").first()).toContainText(
      "Let us review the Nimbus launch plan together.",
    );

    // The same line is in the transcript panel, with the speaker's name.
    await page.getByRole("button", { name: /Show transcript/ }).click();
    await expect(page.getByTestId("transcript-line").first()).toContainText(
      "launch plan",
    );

    // Stopping returns the button to its starting state on both screens.
    await page.getByRole("button", { name: "Stop Nimbus" }).click();
    await expect(page.getByRole("button", { name: "Start Nimbus" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(memberPage.getByTestId("captions")).toHaveCount(0);
  });
});
