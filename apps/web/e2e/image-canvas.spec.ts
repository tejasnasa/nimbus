import { test, expect, e2eState } from "./fixtures";

/**
 * Image to canvas, end to end.
 *
 * A picture is attached in the chat composer, `@nimbusbot` is asked to turn it
 * into a diagram, the generation overlay appears, and a canvas tab opens whose
 * stored document holds the diagram's elements.
 *
 * Nothing external is reached. Cloudinary is stubbed by Playwright route
 * interception (the direct upload and the delivery URL), and the model is the
 * local fake provider (`fake-provider.mjs`, via `AI_TEST_BASE_URL`, honoured
 * only under `NODE_ENV=test`): it answers the routing call with a
 * `create_document` call that sets `fromImage`, and the image call with a
 * three-node diagram after a short pause. The signature comes from the real API
 * route, so the folder and the ownership check the message then passes are the
 * production ones.
 *
 * The seeded workspace is shared with the other specs, so the generated
 * document is deleted at the end.
 */

const room = `/workspace/${e2eState.workspace.slugId}`;
const API = "http://localhost:3001";
/** `CLOUDINARY_CLOUD_NAME` in `.env.test`, which the API under test reads. */
const CLOUD = "test-cloudinary-cloud-name";

/** A 1x1 PNG, enough for an `<img>` to load. */
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test.describe("image to canvas", () => {
  test("an attached picture becomes a canvas when NimbusBot is asked", async ({
    page,
  }) => {
    let uploadedFolder = "";

    // The direct upload: answered with a delivery URL inside the folder the
    // API signed, exactly as Cloudinary would.
    await page.route("https://api.cloudinary.com/**", async (route) => {
      const body = route.request().postData() ?? "";
      const field = (name: string) =>
        new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)`).exec(body)?.[1] ?? "";
      uploadedFolder = field("folder");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({
          secure_url: `https://res.cloudinary.com/${CLOUD}/image/upload/v1/${uploadedFolder}/${field("public_id")}.png`,
        }),
      });
    });
    // The delivery URL the thumbnail loads.
    await page.route("https://res.cloudinary.com/**", (route) =>
      route.fulfill({ status: 200, contentType: "image/png", body: PIXEL }),
    );

    await page.goto(room);
    await expect(page.getByText("Ask anything from @NimbusBot")).toBeVisible();

    // The text above is server-rendered, so the page can be visible before it
    // has hydrated; a file chosen that early is lost. Choosing again until the
    // upload chip appears makes the step independent of that timing.
    await expect(async () => {
      await page.getByTestId("chat-image-input").setInputFiles({
        name: "whiteboard.png",
        mimeType: "image/png",
        buffer: PIXEL,
      });
      await expect(page.getByText("Image ready to send")).toBeVisible({
        timeout: 4_000,
      });
    }).toPass({ timeout: 30_000 });

    await page
      .getByPlaceholder("Type a message...")
      .fill("@nimbusbot turn this into a diagram");
    await page.getByRole("button", { name: "Send" }).click();

    // The picture is in the chat as a thumbnail that opens full size.
    const thumbnail = page.getByTestId("chat-image-link").first();
    await expect(thumbnail).toBeVisible();
    await expect(thumbnail).toHaveAttribute(
      "href",
      new RegExp(`/nimbus/chat/${e2eState.workspace.id}/`),
    );
    expect(uploadedFolder).toBe(`nimbus/chat/${e2eState.workspace.id}`);

    // The generation overlay appears, then a canvas tab replaces it.
    await expect(page.getByText(/Creating "Photo diagram"/)).toBeVisible();
    await expect(page.getByText("Photo diagram").first()).toBeVisible();
    await expect(page.locator(".excalidraw")).toBeVisible();

    // The stored document holds the diagram: three nodes with their labels and
    // two arrows.
    const list = await page.request.get(
      `${API}/api/document/workspace/${e2eState.workspace.id}`,
    );
    const docs: Array<{ id: string; title: string }> = (await list.json())
      .responseObject;
    const created = docs.find((d) => d.title === "Photo diagram");
    expect(created).toBeDefined();

    const full = await page.request.get(`${API}/api/document/${created!.id}`);
    const { canvasData } = (await full.json()).responseObject as {
      canvasData: Array<{ type: string; text?: string }>;
    };
    expect(canvasData).toHaveLength(8);
    expect(canvasData.filter((e) => e.type === "arrow")).toHaveLength(2);
    expect(
      canvasData
        .filter((e) => e.type === "text")
        .map((e) => e.text)
        .sort(),
    ).toEqual(["API", "Client", "Database"]);

    // Leave the shared workspace as the other specs expect it.
    const removed = await page.request.delete(
      `${API}/api/document/${created!.id}`,
    );
    expect(removed.ok()).toBe(true);
  });

  test("the upload signature is scoped to the workspace", async ({ page }) => {
    await page.goto(room);

    const own = await page.request.get(
      `${API}/api/upload/chat-image-signature?workspaceId=${e2eState.workspace.id}`,
    );
    expect(own.status()).toBe(200);
    const sig = (await own.json()).responseObject;
    expect(sig.folder).toBe(`nimbus/chat/${e2eState.workspace.id}`);
    expect(sig.allowedFormats).toBe("jpg,png,webp,heic");

    const other = await page.request.get(
      `${API}/api/upload/chat-image-signature?workspaceId=cm_not_a_workspace_0001`,
    );
    expect(other.status()).toBe(404);
  });
});
