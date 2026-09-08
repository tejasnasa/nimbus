/**
 * @module api/lib/turnCredentials
 * @description Time-limited TURN credentials per the coturn REST API scheme:
 * `username = <expiry Unix ts>:<userId>`, password = Base64(HMAC-SHA1(secret,
 * username)). Clients pass these to the WebRTC peer connection for relay
 * allocation. Requires TURN_SECRET.
 */
import crypto from "crypto";

/**
 * Generates a 24h TURN username/credential pair for a user.
 *
 * @param userId - Stable user identifier embedded in the username.
 * @returns Time-boxed `{ username, credential }` for ICE/TURN config.
 */
export function generateTurnCredentials(userId: string) {
  const secret = process.env.TURN_SECRET!;
  const ttl = 86400; // 24 hours
  const timestamp = Math.floor(Date.now() / 1000) + ttl;
  const username = `${timestamp}:${userId}`;

  const hmac = crypto.createHmac("sha1", secret);
  hmac.update(username);
  const credential = hmac.digest("base64");

  return { username, credential };
}
