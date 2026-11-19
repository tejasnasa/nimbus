/**
 * @module api/middleware/agentAuth
 * @description Authentication for the internal agent routes, in three layers
 * that a request passes in order: the shared bearer secret, a per-IP rate limit
 * on failed ticket redemptions, and (for everything after redemption) the
 * session token.
 *
 * @important The redemption limiter runs after the secret check and only
 *            failures stay counted. Production sits behind a reverse proxy
 *            without a trusted-proxy setting, so `req.ip` is one shared value
 *            for every caller; a limiter that ran first would let anonymous
 *            traffic fill the bucket and lock the real agent out. Do not move
 *            it ahead of {@link requireAgentSecret}.
 *
 * @important Every failure is the same bare 401 envelope. The response never
 *            says whether the secret, the ticket or the session was the wrong
 *            part, so a caller probing the route learns nothing.
 *
 * @important The secret is compared with `timingSafeEqual` over equal-length
 *            SHA-256 digests, so neither its value nor its length leaks through
 *            timing.
 *
 * @important Every internal response is `Cache-Control: no-store`, set before
 *            any check runs, because the redeem response carries a plaintext
 *            provider key and must never be stored by an intermediary.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { prisma } from "@nimbus/db";
import { ServerResponse } from "@nimbus/types";
import type { NextFunction, Request, Response } from "express";
import { readAgentSession } from "../lib/meeting/agentSession";
import { pubClient } from "../lib/redis";

/** Header carrying the session token returned by redemption. */
export const SESSION_HEADER = "x-meeting-session";

/** Redemption attempts allowed per IP per window. */
export const REDEEM_LIMIT = 10;

/** Length of the redemption rate-limit window, in seconds. */
export const REDEEM_WINDOW_SECONDS = 60;

const deny = (res: Response) => {
  const response = ServerResponse.unauthorized("Unauthorized");
  res.status(response.statusCode).json(response);
};

const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * Whether a presented bearer value equals the configured agent secret.
 *
 * @param presented - The raw `Authorization` header value.
 */
export function isValidAgentSecret(presented: string | undefined): boolean {
  const secret = process.env.NIMBUS_AGENT_SECRET;
  if (!secret || !presented) return false;
  const match = /^Bearer (.+)$/.exec(presented);
  if (!match) return false;
  return timingSafeEqual(digest(match[1]), digest(secret));
}

/** Marks the response uncacheable. Mounted first on the internal router. */
export function noStore(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("Cache-Control", "no-store");
  next();
}

/** Refuses a request without the agent bearer secret. */
export function requireAgentSecret(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!isValidAgentSecret(req.get("authorization"))) return deny(res);
  next();
}

/**
 * Limits failed redemptions per IP. Mount it after {@link requireAgentSecret}.
 * Every attempt is counted on arrival, so concurrent guesses cannot slip past,
 * and a successful redemption is handed back with {@link refundRedeemAttempt}.
 * The over-limit answer is the ordinary 401, so a brute-forcer cannot tell
 * throttling from a wrong guess.
 */
export async function redeemRateLimit(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const key = `redeem-rl:${req.ip ?? "unknown"}`;
    const attempts = await pubClient.incr(key);
    if (attempts === 1) await pubClient.expire(key, REDEEM_WINDOW_SECONDS);
    res.locals.redeemAttemptKey = key;
    if (attempts > REDEEM_LIMIT) return deny(res);
  } catch {
    // A Redis failure cannot be allowed to open the door; redemption needs
    // Redis for the ticket anyway, so refusing here costs nothing.
    return deny(res);
  }
  next();
}

/**
 * Gives back the attempt {@link redeemRateLimit} counted for this request, so
 * only failed redemptions stay in the bucket.
 */
export async function refundRedeemAttempt(res: Response): Promise<void> {
  const key = res.locals.redeemAttemptKey as string | undefined;
  if (!key) return;
  try {
    await pubClient.decr(key);
  } catch {
    // A missed refund only makes the limiter stricter for the rest of the window.
  }
}

/**
 * Resolves the session token to its meeting and attaches both to the request.
 * A session whose meeting row is gone is refused like an unknown token.
 */
export async function requireAgentSession(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const session = await readAgentSession(req.get(SESSION_HEADER));
    if (!session) return deny(res);

    const meeting = await prisma.meeting.findUnique({
      where: { id: session.meetingId },
    });
    if (!meeting) return deny(res);

    req.agentSession = { session, meeting };
    next();
  } catch {
    deny(res);
  }
}
