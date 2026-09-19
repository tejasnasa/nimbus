import { test, expect, e2eState } from "./fixtures";

/**
 * Chat delivery over the real Socket.IO transport.
 *
 * This is the one path a component test cannot fake honestly: the message leaves
 * the sender's browser, crosses the API, is persisted, and arrives at a second
 * browser in a separate context.
 */

const room = `/workspace/${e2eState.workspace.slugId}`;

test.describe("chat", () => {
  test("the owner's message reaches the member live", async ({
    page,
    memberPage,
  }) => {
    const content = `hello from the owner ${Date.now()}`;

    await page.goto(room);
    await memberPage.goto(room);

    // Both sockets must be in the workspace room before the send, or the
    // broadcast has nobody to reach and the test would flake rather than fail.
    await expect(page.getByText("Ask anything from @NimbusBot")).toBeVisible();
    await expect(
      memberPage.getByText("Ask anything from @NimbusBot"),
    ).toBeVisible();

    await page.getByPlaceholder("Type a message...").fill(content);
    await page.getByRole("button", { name: "Send" }).click();

    // Sender sees it from its own optimistic-free append; the member only sees
    // it if the server actually relayed the event.
    await expect(page.getByText(content)).toBeVisible();
    await expect(memberPage.getByText(content)).toBeVisible();
  });

  test("Enter sends and clears the composer, Shift+Enter does not", async ({
    page,
  }) => {
    await page.goto(room);

    const composer = page.getByPlaceholder("Type a message...");
    await composer.fill("first line");
    await composer.press("Shift+Enter");

    // A newline must not send; the draft stays in the composer.
    await expect(composer).toHaveValue("first line\n");

    await composer.fill(`sent with enter ${Date.now()}`);
    await composer.press("Enter");

    await expect(composer).toHaveValue("");
  });

  test("a whitespace-only message is not sent", async ({ page }) => {
    await page.goto(room);

    const composer = page.getByPlaceholder("Type a message...");

    // Typed rather than filled: the composer is a controlled component, and a
    // `fill` that lands before React attaches its listener leaves the DOM value
    // ahead of React's state, which the next re-render then reverts.
    await composer.click();
    await composer.pressSequentially("   ");
    await composer.press("Enter");

    // The composer is cleared only after a send is emitted, so a draft that
    // survives Enter proves the handler bailed out before emitting.
    await expect(composer).toHaveValue("   ");
  });
});
