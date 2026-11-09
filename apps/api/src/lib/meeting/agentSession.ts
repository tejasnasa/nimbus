/**
 * @module api/lib/meeting/agentSession
 * @description The session token an agent receives when it redeems its ticket,
 * and its lookup on every later internal request.
 *
 * A session is a random opaque token stored as
 * `agent-session:<token> -> { meetingId, providerId, credentialId }` for six
 * hours. It names exactly one meeting, so a request authenticated with it can
 * only ever read or write that meeting.
 *
 * @important A ticket and a session token live under different key prefixes and
 *            are never interchangeable: a ticket is single-use and is consumed
 *            by redemption, while a session token is reusable until it
 *            expires. The provider recorded on the session is what the usage
 *            route logs and prices calls against; it is never a key.
 */
import { randomBytes } from "node:crypto";
import { pubClient } from "../redis";

/** How long a session token is valid for, in seconds. */
export const SESSION_TTL_SECONDS = 21_600;

/** What a session token resolves to. */
export type AgentSession = {
  meetingId: string;
  /** Registry id of the provider that pays for the meeting's audio. */
  providerId: string;
  credentialId?: string;
};

const sessionKey = (token: string) => `agent-session:${token}`;

/**
 * Mints a session token for a meeting.
 *
 * @param session - The meeting and the provider paying for it.
 * @returns The opaque token, 32 random bytes in base64url.
 */
export async function createAgentSession(
  session: AgentSession,
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await pubClient.set(
    sessionKey(token),
    JSON.stringify(session),
    "EX",
    SESSION_TTL_SECONDS,
  );
  return token;
}

/**
 * Resolves a session token.
 *
 * @param token - The `X-Meeting-Session` header value.
 * @returns The session, or `null` for an unknown, expired or malformed token.
 */
export async function readAgentSession(
  token: string | undefined,
): Promise<AgentSession | null> {
  if (!token || token.length > 128) return null;
  const raw = await pubClient.get(sessionKey(token));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AgentSession>;
    if (typeof parsed.meetingId !== "string") return null;
    return {
      meetingId: parsed.meetingId,
      providerId: String(parsed.providerId ?? "openrouter"),
      credentialId: parsed.credentialId,
    };
  } catch {
    return null;
  }
}
