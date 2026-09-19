/**
 * @module api/__tests__/unit/serverResponse
 * @description The shared REST envelope. Every controller returns one of these,
 * so the client's response parsing depends on this shape and on the status code
 * each factory picks.
 */
import { describe, expect, it } from "vitest";
import { ServerResponse } from "@nimbus/types";

describe("ServerResponse", () => {
  it("always carries the four envelope fields", () => {
    const response = ServerResponse.ok({ id: "1" });

    expect(Object.keys(response).sort()).toEqual([
      "message",
      "responseObject",
      "statusCode",
      "success",
    ]);
  });

  describe("success factories", () => {
    it.each([
      ["ok", () => ServerResponse.ok({}), 200],
      ["created", () => ServerResponse.created({}), 201],
      ["noContent", () => ServerResponse.noContent(), 204],
    ])("%s sets success and the matching status", (_name, build, status) => {
      const response = build();

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(status);
    });

    it("preserves the payload it was given", () => {
      const payload = { id: "doc-1", title: "Doc" };

      expect(ServerResponse.ok(payload).responseObject).toBe(payload);
    });

    it("carries no payload for noContent", () => {
      expect(ServerResponse.noContent().responseObject).toBeNull();
    });
  });

  describe("error factories", () => {
    it.each([
      ["badRequest", () => ServerResponse.badRequest(), 400],
      ["unauthorized", () => ServerResponse.unauthorized(), 401],
      ["forbidden", () => ServerResponse.forbidden(), 403],
      ["notFound", () => ServerResponse.notFound(), 404],
      ["conflict", () => ServerResponse.conflict(), 409],
      ["unprocessableEntity", () => ServerResponse.unprocessableEntity(), 422],
      ["tooManyRequests", () => ServerResponse.tooManyRequests(), 429],
      ["notImplemented", () => ServerResponse.notImplemented(), 501],
      ["serviceUnavailable", () => ServerResponse.serviceUnavailable(), 503],
    ])("%s sets failure and the matching status", (_name, build, status) => {
      const response = build();

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(status);
      expect(response.responseObject).toBeNull();
    });

    it("uses the factory name as the default message", () => {
      expect(ServerResponse.forbidden().message).toBe("Forbidden");
      expect(ServerResponse.notFound().message).toBe("Not Found");
    });

    it("lets the caller override the message", () => {
      expect(ServerResponse.forbidden("Not a member").message).toBe("Not a member");
    });
  });

  describe("internalError", () => {
    // Deliberate signature difference: the payload comes first and is retained
    // so the failing value is visible in logs and responses.
    it("takes the debug payload as its first argument and keeps it", () => {
      const cause = new Error("boom");
      const response = ServerResponse.internalError(cause);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(500);
      expect(response.responseObject).toBe(cause);
      expect(response.message).toBe("Internal Server Error");
    });

    it("allows a null payload", () => {
      expect(ServerResponse.internalError(null).responseObject).toBeNull();
    });
  });
});
