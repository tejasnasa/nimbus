/**
 * @module api/routers/livekitWebhook
 * @description Receives the media server's webhooks and turns them into the
 * call roster: `participant_joined` / `participant_left` add and remove a
 * person, `room_finished` empties the roster, and every change is broadcast to
 * the workspace as `voice:roster`.
 *
 * @important Mounted in `src/app.ts` BEFORE `express.json()`, with
 *            `express.raw({ type: "application/webhook+json" })`. The
 *            signature covers the exact bytes LiveKit sent, so the body must
 *            reach {@link WebhookReceiver} unparsed; once the JSON parser has
 *            touched it, verification can no longer succeed.
 *
 * @important Public, like `/api/health`, and kept out of `master.router.ts`
 *            for the same reason: the caller is the media server and holds no
 *            session. The signature is the only authentication. A body that
 *            fails verification is a bare 401, and nothing from an unverified
 *            body is read, logged or echoed.
 *
 * @important Deliveries are at-least-once, so each event id is claimed in Redis
 *            (`SET webhook:<id> NX EX 3600`) and a repeat is acknowledged
 *            without effect. If handling fails the claim is released and the
 *            response is a 500, so the retry is processed rather than treated
 *            as a duplicate.
 *
 * @important Agent participants never enter the human roster. Their departure
 *            is instead what ends the workspace's live meeting, and a closed
 *            room ends it too. An event stamped well before the live meeting
 *            started belongs to a previous meeting's agent or room (webhooks
 *            can arrive late) and is ignored, so a stale delivery cannot end a
 *            meeting that was just started.
 */
import { prisma } from "@nimbus/db";
import { type VoiceUser } from "@nimbus/types";
import express, { type Request, type Response } from "express";
import { WebhookReceiver, type WebhookEvent } from "livekit-server-sdk";
import type { Server } from "socket.io";
import { livekitCredentials } from "../lib/livekit/client";
import { endMeeting, type MeetingBroadcaster } from "../lib/meeting/lifecycle";
import {
  isAgentParticipant,
  workspaceIdFromRoom,
} from "../lib/livekit/rooms";
import { pubClient } from "../lib/redis";
import { voicePresenceService } from "../lib/voicePresence";

/** The webhook content type LiveKit posts with. */
export const WEBHOOK_CONTENT_TYPE = "application/webhook+json";

/** Path the router is mounted at. */
export const WEBHOOK_PATH = "/api/livekit/webhook";

/** How long a processed event id is remembered, in seconds. */
const DEDUPE_TTL_SECONDS = 3600;

const livekitWebhookRouter = express.Router();

/** Reads the avatar the token carried in the participant's metadata. */
function imageFromMetadata(metadata: string | undefined): string | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as { image?: unknown };
    return typeof parsed.image === "string" ? parsed.image : null;
  } catch {
    return null;
  }
}

/** Broadcasts the workspace's current roster. */
async function broadcastRoster(io: Server | undefined, workspaceId: string) {
  if (!io) return;
  const users = await voicePresenceService.getUsers(workspaceId);
  io.to(workspaceId).emit("voice:roster", { users });
}

/** How much older than the meeting an event must be to count as stale, in ms. */
const STALE_EVENT_MARGIN_MS = 2000;

/**
 * Ends the workspace's live meeting because the media server reported that its
 * agent or room is gone, unless the event predates the meeting.
 */
async function endLiveMeetingFor(
  workspaceId: string,
  event: WebhookEvent,
  reason: "agent-left" | "room-finished",
  io: MeetingBroadcaster | undefined,
) {
  const live = await prisma.meeting.findFirst({
    where: { workspaceId, status: "LIVE" },
    select: { id: true, startedAt: true },
  });
  if (!live) return;
  const eventMs = Number(event.createdAt) * 1000;
  if (eventMs > 0 && eventMs + STALE_EVENT_MARGIN_MS < live.startedAt.getTime()) {
    return;
  }
  await endMeeting(live.id, reason, { io });
}

/** Applies one verified event to the roster and the live meeting. */
async function applyEvent(event: WebhookEvent, io: Server | undefined) {
  const workspaceId = workspaceIdFromRoom(event.room?.name);
  if (!workspaceId) return;

  switch (event.event) {
    case "participant_joined": {
      const participant = event.participant;
      if (!participant?.identity || isAgentParticipant(participant)) return;

      const user: VoiceUser = {
        userId: participant.identity,
        name: participant.name || participant.identity,
        image: imageFromMetadata(participant.metadata),
      };
      await voicePresenceService.addUser(workspaceId, user);
      await broadcastRoster(io, workspaceId);
      return;
    }
    case "participant_left": {
      const participant = event.participant;
      if (!participant?.identity) return;
      if (isAgentParticipant(participant)) {
        await endLiveMeetingFor(workspaceId, event, "agent-left", io);
        return;
      }

      await voicePresenceService.removeUser(workspaceId, participant.identity);
      await broadcastRoster(io, workspaceId);
      return;
    }
    case "room_finished": {
      await voicePresenceService.clear(workspaceId);
      await broadcastRoster(io, workspaceId);
      await endLiveMeetingFor(workspaceId, event, "room-finished", io);
      return;
    }
    default:
      return;
  }
}

/** Handles one delivery. */
async function handleWebhook(req: Request, res: Response) {
  const body: unknown = req.body;

  // `express.raw` leaves the body untouched when the content type does not
  // match, so anything that is not a buffer was not sent as a webhook.
  if (!Buffer.isBuffer(body)) {
    return res.status(415).end();
  }

  let receiver: WebhookReceiver;
  try {
    const { apiKey, apiSecret } = livekitCredentials();
    receiver = new WebhookReceiver(apiKey, apiSecret);
  } catch (error) {
    console.error("[voice] webhook receiver is not configured:", error);
    return res.status(500).end();
  }

  let event: WebhookEvent;
  try {
    event = await receiver.receive(
      body.toString("utf8"),
      req.get("authorization"),
    );
  } catch {
    return res.status(401).end();
  }

  let claimed = false;
  try {
    if (event.id) {
      const result = await pubClient.set(
        `webhook:${event.id}`,
        "1",
        "EX",
        DEDUPE_TTL_SECONDS,
        "NX",
      );
      if (result !== "OK") return res.status(200).end();
      claimed = true;
    }

    await applyEvent(event, req.app.get("io") as Server | undefined);
    return res.status(200).end();
  } catch (error) {
    console.error(
      "[voice] webhook handling failed:",
      error instanceof Error ? error.message : error,
    );
    if (claimed) await pubClient.del(`webhook:${event.id}`).catch(() => {});
    return res.status(500).end();
  }
}

livekitWebhookRouter.post("/", handleWebhook);

export default livekitWebhookRouter;
