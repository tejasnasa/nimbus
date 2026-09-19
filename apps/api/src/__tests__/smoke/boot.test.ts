/**
 * @module api/__tests__/smoke/boot
 * @description Boot smoke tests: the Express app composes, the root route
 * answers, better-auth is mounted ahead of the app routers, and protected
 * routers reject anonymous callers with the standard envelope.
 */
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../app";

const app = createApp();

describe("api smoke: boot", () => {
  it("answers the root health string", async () => {
    const res = await request(app).get("/");

    expect(res.status).toBe(200);
    expect(res.text).toBe("Hello World to u!");
  });

  it("mounts better-auth ahead of the app routers", async () => {
    const res = await request(app).get("/api/auth/get-session");

    // Handled by better-auth (returns a null session), never by authCheck.
    expect(res.status).toBeLessThan(500);
    expect(res.status).not.toBe(404);
  });

  it("rejects an anonymous REST call with the ServerResponse envelope", async () => {
    const res = await request(app).get("/api/workspace");

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({
      success: false,
      statusCode: 401,
      responseObject: null,
    });
  });

  it("authenticates before validating, so a malformed body still yields 401", async () => {
    const res = await request(app).post("/api/workspace/create").send({});

    expect(res.status).toBe(401);
  });

  it("404s an unknown /api path", async () => {
    const res = await request(app).get("/api/definitely-not-a-route");

    expect(res.status).toBe(404);
  });
});
