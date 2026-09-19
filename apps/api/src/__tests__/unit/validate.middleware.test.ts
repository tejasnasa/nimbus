/**
 * @module api/__tests__/unit/validate.middleware
 * @description Contract for the Zod body-validation middleware: valid bodies
 * pass through, invalid ones short-circuit with a 400 `ServerResponse` carrying
 * treeified Zod errors.
 *
 * @important The middleware documents that the *parsed* value is not forwarded —
 *            controllers re-read the raw `req.body`. The coercion test below
 *            pins that, because a schema that coerces or transforms would
 *            otherwise silently disagree with what controllers receive.
 */
import express, { type Express } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import validate from "../../middleware/validate.middleware";

/** Mounts a one-route app whose handler echoes the body it actually received. */
const buildApp = (schema: z.ZodTypeAny): Express => {
  const app = express();
  app.use(express.json());
  app.post(
    "/echo",
    validate(schema),
    (req, res) => void res.status(200).json({ received: req.body }),
  );
  return app;
};

describe("middleware/validate", () => {
  const schema = z.object({
    name: z.string().min(3, "Workspace name must be at least 3 characters"),
  });

  it("lets a valid body through to the handler", async () => {
    const res = await request(buildApp(schema))
      .post("/echo")
      .send({ name: "Valid Name" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: { name: "Valid Name" } });
  });

  it("rejects an invalid body with the ServerResponse envelope", async () => {
    const res = await request(buildApp(schema))
      .post("/echo")
      .send({ name: "no" });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      message: "Validation failed",
      statusCode: 400,
    });
  });

  it("includes treeified Zod errors naming the offending field", async () => {
    const res = await request(buildApp(schema))
      .post("/echo")
      .send({ name: "no" });

    // z.treeifyError nests issues under the field path.
    expect(res.body.responseObject).toMatchObject({
      properties: {
        name: { errors: ["Workspace name must be at least 3 characters"] },
      },
    });
  });

  it("rejects a missing required field", async () => {
    const res = await request(buildApp(schema)).post("/echo").send({});

    expect(res.status).toBe(400);
    expect(res.body.responseObject.properties.name.errors.length).toBeGreaterThan(0);
  });

  it("validates nested schemas", async () => {
    const nested = z.object({
      outer: z.object({ inner: z.string().min(2, "Inner too short") }),
    });

    const bad = await request(buildApp(nested))
      .post("/echo")
      .send({ outer: { inner: "x" } });
    expect(bad.status).toBe(400);
    expect(bad.body.responseObject.properties.outer.properties.inner.errors).toEqual([
      "Inner too short",
    ]);

    const good = await request(buildApp(nested))
      .post("/echo")
      .send({ outer: { inner: "ok" } });
    expect(good.status).toBe(200);
  });

  // Pins the documented behaviour: the parsed result is discarded, so a
  // coercing schema does NOT change what the controller sees.
  it("does not forward the coerced value — handlers see the raw body", async () => {
    const coercing = z.object({ count: z.coerce.number() });

    const res = await request(buildApp(coercing))
      .post("/echo")
      .send({ count: "5" });

    expect(res.status).toBe(200);
    expect(res.body.received.count).toBe("5");
  });
});
