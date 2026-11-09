/**
 * @module api/lib/meeting/tickets
 * @description One-time tickets that carry an agent from "dispatched" to "has
 * its keys": issuing one when the assistant starts, and redeeming it when the
 * agent joins.
 *
 * The dispatch metadata holds only the ticket. The agent presents it to
 * `/internal/agent/redeem`, which is the one place a plaintext voice key leaves
 * the API, so a ticket that leaks from the media server's logs is worth
 * nothing after a minute or after first use.
 *
 * @important A ticket is `SET ticket:<t> <meetingId> EX 60 NX` and redeemed
 *            with `GETDEL`, so it works exactly once even under concurrent
 *            redemptions. Redemption resolves the voice key again, because the
 *            key may have been removed or the free seconds spent in the last
 *            minute; a refusal then ends the meeting rather than leaving it
 *            "joining".
 *
 * @important This is the only module allowed to import `voiceEntitlements`
 *            (enforced by a lint rule), which is what keeps the number of code
 *            paths that can produce a plaintext key at one.
 */
import { randomBytes } from "node:crypto";
import { prisma } from "@nimbus/db";
import {
  AGENT_WAKE_NAMES,
  type AgentMember,
  type MeetingEndReason,
  type RedeemResponse,
} from "@nimbus/types";
import { resolveVoice } from "../ai/voiceEntitlements";
import { env } from "../env";
import { pubClient } from "../redis";
import { createAgentSession } from "./agentSession";

/** How long a ticket can wait to be redeemed, in seconds. */
export const TICKET_TTL_SECONDS = 60;

const ticketKey = (ticket: string) => `ticket:${ticket}`;

/**
 * Issues a ticket for a meeting.
 *
 * @param meetingId - The meeting the agent is being dispatched to.
 * @returns 32 random bytes in base64url.
 */
export async function issueTicket(meetingId: string): Promise<string> {
  const ticket = randomBytes(32).toString("base64url");
  const stored = await pubClient.set(
    ticketKey(ticket),
    meetingId,
    "EX",
    TICKET_TTL_SECONDS,
    "NX",
  );
  if (stored !== "OK") throw new Error("Could not store the meeting ticket");
  return ticket;
}

/** The outcome of redeeming a ticket. */
export type RedeemResult =
  | { ok: true; payload: RedeemResponse }
  | {
      ok: false;
      /** Set when a valid ticket was refused because voice can no longer run. */
      endMeeting?: { meetingId: string; reason: MeetingEndReason };
    };

/**
 * Redeems a ticket for the session's configuration and keys.
 *
 * @param ticket - The value from the dispatch metadata.
 * @returns The payload, or a failure that says nothing about why to the caller.
 */
export async function redeemTicket(ticket: string): Promise<RedeemResult> {
  const meetingId = await pubClient.getdel(ticketKey(ticket));
  if (!meetingId) return { ok: false };

  const meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
  if (!meeting || meeting.status !== "LIVE" || !meeting.startedById) {
    return { ok: false };
  }

  const voice = await resolveVoice({
    workspaceId: meeting.workspaceId,
    userId: meeting.startedById,
  });
  if (!voice.ok) {
    return {
      ok: false,
      endMeeting: {
        meetingId,
        reason: voice.reason === "spend-cap-reached" ? "spend-cap" : "invalid-key",
      },
    };
  }

  const memberRows = await prisma.workspaceMember.findMany({
    where: {
      workspaceId: meeting.workspaceId,
      userId: { not: env.BOT_USERID },
    },
    select: { user: { select: { id: true, name: true } } },
  });
  const members: AgentMember[] = memberRows.map(({ user }) => ({
    userId: user.id,
    name: user.name,
  }));

  const providerId = voice.providerId ?? "openrouter";
  const sessionToken = await createAgentSession({
    meetingId,
    providerId,
    credentialId: voice.credentialId,
  });

  return {
    ok: true,
    payload: {
      sessionToken,
      meetingId,
      workspaceId: meeting.workspaceId,
      roomName: meeting.roomName,
      startedAt: meeting.startedAt.toISOString(),
      members,
      voice: {
        baseUrl: voice.transcription.baseUrl.replace(/\/+$/, ""),
        apiKey: voice.transcription.apiKey,
        transcribeModel: voice.transcription.model,
        speechModel: voice.speech?.model,
        voice: voice.speech?.voice,
      },
      budgetSeconds: meeting.budgetSeconds,
      assistantSpeaks: voice.speech !== undefined,
      wakeNames: [...AGENT_WAKE_NAMES],
    },
  };
}
