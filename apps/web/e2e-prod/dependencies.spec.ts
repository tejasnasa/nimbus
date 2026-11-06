import { test, expect } from "./fixtures";
import { apiUrl } from "./env";

/**
 * Endpoint-level probes for the third-party configuration the deployed API
 * depends on. Strictly read-only: nothing is uploaded, no call is placed, no row
 * is written.
 *
 * @important Two of these are weaker than they look, and the test names say so
 *            rather than implying more. `/api/turn/credentials` mints its
 *            credential locally from `TURN_SECRET`, and the avatar signature is
 *            computed locally from `CLOUDINARY_API_SECRET` — both produce a
 *            well-formed answer even when the secret is wrong. They prove the
 *            variable is *present*, not that Coturn or Cloudinary would accept
 *            it. The AI status check is different: it reads live state.
 */

test.describe("dependency wiring", () => {
  test("the free-usage endpoint reports the operator free tier configured", async ({
    context,
  }) => {
    const response = await context.request.get(`${apiUrl}/api/ai/me/free-usage`);

    expect(
      response.status(),
      `GET ${apiUrl}/api/ai/me/free-usage returned ${response.status()}. A 404 ` +
        "means the deployed API predates the workspace AI routes, which leaves " +
        "the chat panel disabled for every user.",
    ).toBe(200);

    const body = await response.json();

    // `unconfigured` means the deployment has no operator key. The smoke user's
    // workspaces hold no key of their own by design, so a configured state is
    // what proves the operator key reached the droplet — the failure mode
    // recorded when a deploy ships without its env.
    expect(body.responseObject?.docsState).not.toBe("unconfigured");
  });

  test("a workspace's AI status reports chat enabled", async ({ context }) => {
    const listed = await context.request.get(`${apiUrl}/api/workspace/`);
    expect(listed.status()).toBe(200);
    const workspaces: Array<{ id: string }> =
      (await listed.json()).responseObject ?? [];

    // Read-only: this uses a workspace the smoke user already belongs to and
    // creates none. With none present the free-usage test above is the check.
    test.skip(workspaces.length === 0, "the smoke user has no workspace to read");

    const response = await context.request.get(
      `${apiUrl}/api/ai/workspaces/${workspaces[0]!.id}/status`,
    );
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.responseObject?.features?.chat?.enabled).toBe(true);
  });

  test("the TURN endpoint mints credentials (env wired, not relay proven)", async ({
    context,
  }) => {
    const response = await context.request.get(`${apiUrl}/api/turn/credentials`);

    expect(response.status()).toBe(200);

    const body = await response.json();
    const iceServers = body.responseObject?.iceServers ?? [];

    const turn = iceServers.find((server: { username?: string }) => server.username);

    expect(turn, "no ICE server carried a TURN credential").toBeTruthy();
    expect(turn.credential).toBeTruthy();
  });

  test("the avatar signature endpoint signs (env wired, not upload proven)", async ({
    context,
  }) => {
    const response = await context.request.get(
      `${apiUrl}/api/upload/avatar-signature`,
    );

    expect(response.status()).toBe(200);

    const body = await response.json();

    expect(body.responseObject?.signature).toBeTruthy();
    expect(body.responseObject?.cloudName).toBeTruthy();
    // The API secret must never cross the wire.
    expect(JSON.stringify(body)).not.toContain("api_secret");
  });
});
