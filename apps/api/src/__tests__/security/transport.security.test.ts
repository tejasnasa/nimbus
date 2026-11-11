/**
 * @module api/__tests__/security/transport
 * @description Transport-level hardening: CORS is pinned to the configured
 * frontend origin, and malformed input is answered as a client error rather than
 * crashing the process or leaking a 5xx.
 *
 * The malformed-input cases deliberately assert "4xx, not 5xx" rather than an
 * exact status: the security property is that bad input is rejected cleanly.
 */
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../app";
import {
  as,
  closeTestResources,
  mintUser,
  resetDatabase,
  signWebhook,
  type TestUser,
} from "@testhelpers";

const app = createApp();
const ALLOWED_ORIGIN = process.env.FRONTEND_URL ?? "http://localhost:3000";

afterAll(closeTestResources);

const isClientError = (status: number) => status >= 400 && status < 500;

describe("security: transport", () => {
  describe("CORS", () => {
    it("allows the configured frontend origin, with credentials", async () => {
      const res = await request(app).get("/").set("Origin", ALLOWED_ORIGIN);

      expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED_ORIGIN);
      expect(res.headers["access-control-allow-credentials"]).toBe("true");
    });

    it("never reflects the caller's origin back to a disallowed site", async () => {
      const res = await request(app).get("/").set("Origin", "http://evil.test");

      // `cors` is configured with a static origin string, so it always names the
      // configured frontend origin and never reflects the caller's. A browser at
      // evil.test therefore rejects the response, because ACAO ≠ its own origin.
      // Note it is still *sent* — only the value keeps this safe.
      expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED_ORIGIN);
      expect(res.headers["access-control-allow-origin"]).not.toBe("http://evil.test");
    });

    it("answers a preflight from the allowed origin", async () => {
      const res = await request(app)
        .options("/api/workspace")
        .set("Origin", ALLOWED_ORIGIN)
        .set("Access-Control-Request-Method", "GET");

      expect(res.status).toBeLessThan(300);
      expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED_ORIGIN);
    });

    it("allows every method the API's routes use in a preflight", async () => {
      const res = await request(app)
        .options("/api/action-items/some-id")
        .set("Origin", ALLOWED_ORIGIN)
        .set("Access-Control-Request-Method", "PATCH");

      // A browser refuses any method missing here before the request is sent,
      // so a route using it fails for real users while the server never sees it.
      const allowed = String(res.headers["access-control-allow-methods"]).split(",");
      for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
        expect(allowed).toContain(method);
      }
    });
  });

  describe("malformed input", () => {
    let user: TestUser;

    beforeEach(async () => {
      await resetDatabase();
      user = await mintUser(app);
    });

    it("rejects malformed JSON as a client error, not a crash", async () => {
      const res = await as(app, user)
        .post("/api/workspace/create")
        .set("Content-Type", "application/json")
        .send('{"name": ');

      expect(isClientError(res.status)).toBe(true);
    });

    it("rejects a body beyond the parser's size limit", async () => {
      const res = await as(app, user)
        .post("/api/workspace/create")
        .send({ name: "x".repeat(200_000), description: "" });

      expect(isClientError(res.status)).toBe(true);
    });

    it("treats an SQL-injection invite code as merely invalid", async () => {
      const res = await as(app, user)
        .post("/api/workspace/join")
        .send({ inviteCode: "' OR 1=1 --" });

      expect(res.status).toBe(404);
    });

    // A path segment is unvalidated input, so a stale link, a truncated URL or
    // a crawler must be answered as a bad request rather than reported as a
    // server fault. The guard lives in `getWorkspaceBySlugId`.
    it("answers a non-numeric workspace slug with a 400", async () => {
      const res = await as(app, user).get("/api/workspace/not-a-number");

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ success: false, statusCode: 400 });
    });

    it("handles a garbage document id without crashing", async () => {
      const res = await as(app, user).get("/api/document/cm_not_a_real_id_0000");

      expect(isClientError(res.status)).toBe(true);
    });

    it("stores an XSS payload as inert data and returns it verbatim", async () => {
      // Exactly 25 chars, so it satisfies the name schema's max.
      const payload = "<script>alert(1)</script>";

      const res = await as(app, user)
        .post("/api/workspace/create")
        .send({ name: payload, description: "" });

      expect(res.status).toBe(201);
      // Escaping is the client's job; the API must not mangle or interpret it.
      expect(res.body.responseObject.name).toBe(payload);
    });
  });

  describe("webhook logging", () => {
    /** Everything written to stdout/stderr or the console while `work` runs. */
    const captureOutput = async (work: () => Promise<unknown>) => {
      const chunks: string[] = [];
      const record = (chunk: unknown) => {
        chunks.push(String(chunk));
        return true;
      };
      const out = vi.spyOn(process.stdout, "write").mockImplementation(record);
      const err = vi.spyOn(process.stderr, "write").mockImplementation(record);
      try {
        await work();
      } finally {
        out.mockRestore();
        err.mockRestore();
      }
      return chunks.join("");
    };

    it("logs ordinary requests (control for the capture below)", async () => {
      const output = await captureOutput(() => request(app).get("/"));

      expect(output).toContain("GET /");
    });

    it("never writes a webhook delivery to the access log", async () => {
      const SENTINEL = "sentinel-participant-name-7f3a";
      const { body, authorization } = await signWebhook({
        event: "participant_joined",
        room: { name: "nimbus-ws-cm0000000000000000000000" },
        participant: { identity: "user-x", name: SENTINEL },
      });

      const output = await captureOutput(() =>
        request(app)
          .post("/api/livekit/webhook")
          .set("Content-Type", "application/webhook+json")
          .set("Authorization", authorization)
          .send(body),
      );

      expect(output).not.toContain(SENTINEL);
      expect(output).not.toContain("/api/livekit/webhook");
      expect(output).not.toContain(authorization);
    });

    it("does not log a rejected delivery either", async () => {
      const SENTINEL = "sentinel-forged-body-91bc";

      const output = await captureOutput(() =>
        request(app)
          .post("/api/livekit/webhook")
          .set("Content-Type", "application/webhook+json")
          .send(JSON.stringify({ event: "participant_joined", note: SENTINEL })),
      );

      expect(output).not.toContain(SENTINEL);
      expect(output).not.toContain("/api/livekit/webhook");
    });
  });
});
