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
  test("the AI status endpoint reports chat enabled", async ({ context }) => {
    const response = await context.request.get(`${apiUrl}/api/ai/status`);

    expect(
      response.status(),
      `GET ${apiUrl}/api/ai/status returned ${response.status()}. A 404 means ` +
        "the deployed API predates the route, which leaves the chat panel " +
        "disabled for every user.",
    ).toBe(200);

    const body = await response.json();

    // Enabled means the caller has a BYOK credential *or* the deployment has an
    // operator key. The smoke user holds no credential of its own by design, so
    // this passing is what proves the operator key reached the droplet — the
    // failure mode recorded when a deploy ships without its env.
    expect(body.responseObject?.chat?.enabled).toBe(true);
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
