/**
 * @module api/__tests__/unit/livekitTokens
 * @description What a minted call token actually grants, read back from the
 * signed JWT. The grant is the whole security model of the call, so the test
 * decodes the token rather than trusting the builder call that made it.
 */
import { TokenVerifier } from "livekit-server-sdk";
import { describe, expect, it } from "vitest";
import { roomNameFor } from "../../lib/livekit/rooms";
import { createParticipantToken } from "../../lib/livekit/tokens";

const user = { id: "user-1", name: "Ada Lovelace", image: "https://img.test/a.png" };

const verify = (token: string) =>
  new TokenVerifier(
    process.env.LIVEKIT_API_KEY!,
    process.env.LIVEKIT_API_SECRET!,
  ).verify(token);

describe("lib/livekit/tokens", () => {
  it("carries the user's identity, name and avatar", async () => {
    const claims = await verify(
      await createParticipantToken({ user, workspaceId: "ws-1" }),
    );

    expect(claims.sub).toBe("user-1");
    expect(claims.name).toBe("Ada Lovelace");
    expect(JSON.parse(claims.metadata!)).toEqual({ image: user.image });
  });

  it("records a missing avatar as null", async () => {
    const claims = await verify(
      await createParticipantToken({
        user: { id: "u", name: "No Image" },
        workspaceId: "ws-1",
      }),
    );

    expect(JSON.parse(claims.metadata!)).toEqual({ image: null });
  });

  it("scopes the grant to the workspace's own room", async () => {
    const claims = await verify(
      await createParticipantToken({ user, workspaceId: "ws-1" }),
    );

    expect(claims.video).toMatchObject({
      roomJoin: true,
      room: roomNameFor("ws-1"),
    });
    expect(claims.video?.roomCreate).toBeFalsy();
    expect(claims.video?.roomAdmin).toBeFalsy();
  });

  it("allows publishing the microphone and nothing else", async () => {
    const claims = await verify(
      await createParticipantToken({ user, workspaceId: "ws-1" }),
    );

    expect(claims.video?.canPublish).toBe(true);
    expect(claims.video?.canSubscribe).toBe(true);
    expect(claims.video?.canPublishData).toBe(true);
    // Sources travel as names; the point is that exactly one
    // source is listed and it is the microphone.
    expect(claims.video?.canPublishSources).toEqual([
      expect.stringMatching(/microphone/i),
    ]);
  });

  it("expires after ten minutes", async () => {
    const claims = await verify(
      await createParticipantToken({ user, workspaceId: "ws-1" }),
    );

    const lifetime = claims.exp! - claims.nbf!;
    expect(lifetime).toBeGreaterThanOrEqual(595);
    expect(lifetime).toBeLessThanOrEqual(605);
  });

  it("is signed with the configured secret and no other", async () => {
    const token = await createParticipantToken({ user, workspaceId: "ws-1" });

    await expect(
      new TokenVerifier(process.env.LIVEKIT_API_KEY!, "wrong-secret").verify(
        token,
      ),
    ).rejects.toThrow();
  });
});
