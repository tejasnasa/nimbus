/**
 * @module testhelpers/livekit
 * @description Helpers for the voice suites: signing webhook deliveries the way
 * the media server does, and reaching the dev server's room API.
 *
 * Everything here targets the throwaway dev server from
 * `docker-compose.test.yml` (`devkey` / `secret`). The webhook signer takes the
 * secret from the environment, so it can never sign for a real project unless
 * the test environment has been pointed at one.
 */
import { createHash, randomUUID } from "node:crypto";
import { Room as RtcRoom } from "@livekit/rtc-node";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import { createParticipantToken } from "../src/lib/livekit/tokens";

/** The fields of a delivery a test cares about. */
export type WebhookFixture = {
  event: "participant_joined" | "participant_left" | "room_finished" | string;
  room?: { name: string };
  participant?: {
    identity: string;
    name?: string;
    metadata?: string;
    kind?: number;
  };
  /** Seconds since the epoch; defaults to now. Set it to age a delivery. */
  createdAt?: number;
  /** Defaults to a fresh id so deliveries are distinct unless a test says otherwise. */
  id?: string;
};

/** A request body and the `Authorization` header that vouches for it. */
export type SignedWebhook = { body: string; authorization: string };

/**
 * Signs a webhook delivery: the body's SHA-256 travels inside a JWT signed with
 * the API secret, which is exactly what `WebhookReceiver` checks.
 *
 * @param fixture - The event to deliver.
 * @param secret - Signing secret; defaults to `LIVEKIT_API_SECRET`. Pass a
 *                 different one to forge a delivery.
 * @returns The exact body string to post and its `Authorization` value.
 */
export const signWebhook = async (
  fixture: WebhookFixture,
  secret: string = process.env.LIVEKIT_API_SECRET!,
): Promise<SignedWebhook> => {
  const body = JSON.stringify({
    id: randomUUID(),
    createdAt: Math.floor(Date.now() / 1000),
    ...fixture,
  });
  const token = new AccessToken(process.env.LIVEKIT_API_KEY!, secret);
  token.sha256 = createHash("sha256").update(body).digest("base64");
  return { body, authorization: await token.toJwt() };
};

/** A room API client for the dev server. */
export const devRoomService = (): RoomServiceClient =>
  new RoomServiceClient(
    process.env.LIVEKIT_URL!.replace(/^ws/, "http"),
    process.env.LIVEKIT_API_KEY!,
    process.env.LIVEKIT_API_SECRET!,
  );

const connected: RtcRoom[] = [];

/**
 * Puts a real participant in a workspace's call on the dev server, using a
 * token the API itself mints, so the room genuinely has a human in it.
 *
 * @param user - The participant; their id becomes their identity.
 * @param workspaceId - The workspace whose room to join.
 * @returns A handle to leave the call. Everything left open is closed by
 *          {@link leaveAllCalls}.
 */
export const joinCall = async (
  user: { id: string; name: string },
  workspaceId: string,
) => {
  const token = await createParticipantToken({ user, workspaceId });
  const room = new RtcRoom();
  await room.connect(process.env.LIVEKIT_URL!, token, { autoSubscribe: false });
  connected.push(room);
  return { room, leave: () => room.disconnect() };
};

/** Disconnects every participant {@link joinCall} opened. Call from `afterEach`. */
export const leaveAllCalls = async () => {
  await Promise.all(connected.splice(0).map((room) => room.disconnect()));
};
