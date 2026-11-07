/**
 * @module api/__tests__/integration/http/voice
 * @description The authenticated voice routes: minting a call token and reading
 * the roster. A non-member gets the same 404 as any other workspace read, and a
 * token is never issued for a workspace the caller is not in.
 */
import { TokenVerifier } from "livekit-server-sdk";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../../app";
import { roomNameFor } from "../../../lib/livekit/rooms";
import { voicePresenceService } from "../../../lib/voicePresence";
import {
  addMember,
  as,
  closeTestResources,
  createWorkspace,
  mintUser,
  resetDatabase,
  type TestUser,
} from "@testhelpers";

const app = createApp();

afterAll(closeTestResources);

describe("http: voice", () => {
  let owner: TestUser;
  let member: TestUser;
  let outsider: TestUser;
  let workspaceId: string;

  beforeEach(async () => {
    await resetDatabase();
    owner = await mintUser(app, { name: "Olive Owner" });
    member = await mintUser(app, { name: "Mia Member" });
    outsider = await mintUser(app, { name: "Otto Outsider" });
    workspaceId = (await createWorkspace(owner.id)).id;
    await addMember(workspaceId, member.id, "MEMBER");
  });

  describe("POST /api/voice/token", () => {
    it("issues a token scoped to the workspace's room for a member", async () => {
      const res = await as(app, member)
        .post("/api/voice/token")
        .send({ workspaceId });

      expect(res.status).toBe(200);
      const { token, url, roomName } = res.body.responseObject;
      expect(roomName).toBe(roomNameFor(workspaceId));
      expect(url).toBe(process.env.LIVEKIT_URL);

      const claims = await new TokenVerifier(
        process.env.LIVEKIT_API_KEY!,
        process.env.LIVEKIT_API_SECRET!,
      ).verify(token);
      expect(claims.sub).toBe(member.id);
      expect(claims.name).toBe("Mia Member");
      expect(claims.video?.room).toBe(roomName);
    });

    it("never puts the API secret in the response", async () => {
      const res = await as(app, member)
        .post("/api/voice/token")
        .send({ workspaceId });

      expect(JSON.stringify(res.body)).not.toContain(
        process.env.LIVEKIT_API_SECRET!,
      );
    });

    it("answers a non-member with 404 and issues nothing", async () => {
      const res = await as(app, outsider)
        .post("/api/voice/token")
        .send({ workspaceId });

      expect(res.status).toBe(404);
      expect(res.body.responseObject).toBeNull();
    });

    it("answers an unknown workspace the same way as a foreign one", async () => {
      const res = await as(app, member)
        .post("/api/voice/token")
        .send({ workspaceId: "does-not-exist" });

      expect(res.status).toBe(404);
    });

    it("rejects a body without a workspace id", async () => {
      const res = await as(app, member).post("/api/voice/token").send({});

      expect(res.status).toBe(400);
    });

    it("answers a curated 500 when voice is not configured", async () => {
      const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
      const secret = process.env.LIVEKIT_API_SECRET;
      delete process.env.LIVEKIT_API_SECRET;

      try {
        const res = await as(app, member)
          .post("/api/voice/token")
          .send({ workspaceId });

        expect(res.status).toBe(500);
        expect(res.body.message).toBe("Voice is unavailable right now");
        expect(JSON.stringify(res.body)).not.toMatch(/LIVEKIT_API_SECRET/);
      } finally {
        process.env.LIVEKIT_API_SECRET = secret;
        errorLog.mockRestore();
      }
    });

    it("stops issuing tokens once the member is removed", async () => {
      await as(app, owner)
        .delete(`/api/workspace/leave/${workspaceId}`)
        .send({ memberId: member.id })
        .expect(200);

      const res = await as(app, member)
        .post("/api/voice/token")
        .send({ workspaceId });

      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/voice/:workspaceId/roster", () => {
    it("returns who is on the call", async () => {
      await voicePresenceService.addUser(workspaceId, {
        userId: owner.id,
        name: "Olive Owner",
        image: null,
      });

      const res = await as(app, member).get(`/api/voice/${workspaceId}/roster`);

      expect(res.status).toBe(200);
      expect(res.body.responseObject.users).toEqual([
        { userId: owner.id, name: "Olive Owner", image: null },
      ]);
    });

    it("returns an empty roster when nobody is on the call", async () => {
      const res = await as(app, member).get(`/api/voice/${workspaceId}/roster`);

      expect(res.status).toBe(200);
      expect(res.body.responseObject.users).toEqual([]);
    });

    it("answers a non-member with 404", async () => {
      const res = await as(app, outsider).get(
        `/api/voice/${workspaceId}/roster`,
      );

      expect(res.status).toBe(404);
    });
  });
});
