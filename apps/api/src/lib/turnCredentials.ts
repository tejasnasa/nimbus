import crypto from "crypto";

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
