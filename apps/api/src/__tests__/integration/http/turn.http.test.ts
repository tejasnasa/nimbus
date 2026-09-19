/**
 * @module api/__tests__/integration/http/turn
 * @description The ICE-configuration endpoint. Clients fetch this before opening
 * a peer connection, so the shape matters: public STUN servers plus a TURN entry
 * carrying time-boxed credentials.
 *
 * The credential is verified against Coturn's scheme (base64 HMAC-SHA1 of the
 * username, keyed on `TURN_SECRET`) rather than merely being present.
 */
import { createHmac } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../app";
import {
  as,
  closeTestResources,
  mintUser,
  resetDatabase,
  type TestUser,
} from "@testhelpers";

const app = createApp();
const TTL_SECONDS = 86_400;

afterAll(closeTestResources);

type IceServer = { urls: string | string[]; username?: string; credential?: string };

describe("http: turn credentials", () => {
  let user: TestUser;

  beforeEach(async () => {
    await resetDatabase();
    user = await mintUser(app);
  });

  it("returns a STUN + TURN iceServers list", async () => {
    const res = await as(app, user).get("/api/turn/credentials");

    expect(res.status).toBe(200);

    const iceServers = res.body.responseObject.iceServers as IceServer[];
    expect(iceServers.length).toBeGreaterThan(0);
    expect(iceServers.some((s) => String(s.urls).startsWith("stun:"))).toBe(true);
    expect(iceServers.some((s) => String(s.urls).includes("transport=udp"))).toBe(true);
    expect(iceServers.some((s) => String(s.urls).includes("transport=tcp"))).toBe(true);
  });

  it("embeds the caller's id and a future expiry in the TURN username", async () => {
    const res = await as(app, user).get("/api/turn/credentials");
    const turn = (res.body.responseObject.iceServers as IceServer[]).find(
      (s) => s.username,
    );

    expect(turn?.username).toBeDefined();
    const [expiry, userId] = turn!.username!.split(":");

    expect(userId).toBe(user.id);
    expect(Number(expiry)).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(Number(expiry)).toBeLessThanOrEqual(
      Math.floor(Date.now() / 1000) + TTL_SECONDS + 5,
    );
  });

  it("signs the username with base64 HMAC-SHA1 keyed on TURN_SECRET", async () => {
    const res = await as(app, user).get("/api/turn/credentials");
    const turn = (res.body.responseObject.iceServers as IceServer[]).find(
      (s) => s.credential,
    );

    const expected = createHmac("sha1", process.env.TURN_SECRET!)
      .update(turn!.username!)
      .digest("base64");

    expect(turn?.credential).toBe(expected);
  });

  it("never discloses the shared secret", async () => {
    const res = await as(app, user).get("/api/turn/credentials");

    expect(JSON.stringify(res.body)).not.toContain(process.env.TURN_SECRET!);
  });

  it("requires authentication", async () => {
    const res = await (await import("supertest")).default(app).get("/api/turn/credentials");

    expect(res.status).toBe(401);
  });

  it("fails loudly when TURN_SERVER_URL is unconfigured", async () => {
    const original = process.env.TURN_SERVER_URL;
    delete process.env.TURN_SERVER_URL;

    try {
      const res = await as(app, user).get("/api/turn/credentials");

      // Pinned: a misconfigured deployment surfaces as a 500 per request rather
      // than refusing to boot. See the note on TURN_SECRET validation.
      expect(res.status).toBe(500);
      expect(res.body.message).toMatch(/turn server configuration is missing/i);
    } finally {
      process.env.TURN_SERVER_URL = original;
    }
  });
});
