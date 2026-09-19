/**
 * @module api/__tests__/unit/error.middleware
 * @description Contract of the two terminal handlers.
 *
 * These decide what a client sees when a request is refused or a handler
 * throws, so the behaviours pinned here are the ones that previously leaked an
 * HTML page out of a JSON API: an unknown `/api/*` path, and a body the parser
 * rejected. The status carried by a thrown middleware error must survive — a
 * malformed body is the caller's mistake, not a server fault.
 */
import { describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import {
  apiNotFoundHandler,
  errorHandler,
} from "../../middleware/error.middleware";

/** Minimal `res` recording the status and body an Express handler produced. */
const mockRes = (headersSent = false) => {
  const res = {
    headersSent,
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
};

const mockReq = (method: string, originalUrl: string) =>
  ({ method, originalUrl }) as Request;

describe("middleware/error", () => {
  describe("apiNotFoundHandler", () => {
    it("answers an unknown route with the 404 envelope", () => {
      const res = mockRes();

      apiNotFoundHandler(
        mockReq("GET", "/api/definitely-not-a-route"),
        res,
      );

      expect(res.statusCode).toBe(404);
      expect(res.body).toMatchObject({
        success: false,
        statusCode: 404,
        responseObject: null,
      });
    });

    it("names the method and path so the client can see what it asked for", () => {
      const res = mockRes();

      apiNotFoundHandler(mockReq("PUT", "/api/workspace/nope"), res);

      expect((res.body as { message: string }).message).toBe(
        "Cannot PUT /api/workspace/nope",
      );
    });
  });

  describe("errorHandler", () => {
    it("passes the error on when the response has already started", () => {
      const res = mockRes(true);
      const next = vi.fn();
      const err = new Error("too late");

      errorHandler(err, mockReq("GET", "/api/x"), res, next as NextFunction);

      // Writing a second time would throw over a partial response, so Express is
      // left to close the connection instead.
      expect(next).toHaveBeenCalledWith(err);
      expect(res.statusCode).toBe(0);
    });

    it("preserves a 4xx status carried by middleware, and its message", () => {
      const res = mockRes();
      const err = Object.assign(new SyntaxError("Unexpected end of JSON input"), {
        status: 400,
      });
      vi.spyOn(console, "error").mockImplementation(() => {});

      errorHandler(err, mockReq("POST", "/api/workspace/create"), res, vi.fn());

      // The parser's rejection is a client error; reporting it as a 500 is the
      // misreporting this handler exists to remove.
      expect(res.statusCode).toBe(400);
      expect(res.body).toMatchObject({
        success: false,
        statusCode: 400,
        message: "Unexpected end of JSON input",
      });
    });

    it("preserves a status that has no static factory, such as 413", () => {
      const res = mockRes();
      const err = Object.assign(new Error("request entity too large"), {
        status: 413,
      });
      vi.spyOn(console, "error").mockImplementation(() => {});

      errorHandler(err, mockReq("POST", "/api/workspace/create"), res, vi.fn());

      expect(res.statusCode).toBe(413);
      expect(res.body).toMatchObject({ success: false, statusCode: 413 });
    });

    it("honours the statusCode spelling as well as status", () => {
      const res = mockRes();
      const err = Object.assign(new Error("gone"), { statusCode: 404 });
      vi.spyOn(console, "error").mockImplementation(() => {});

      errorHandler(err, mockReq("GET", "/api/x"), res, vi.fn());

      expect(res.statusCode).toBe(404);
    });

    it("answers an unhandled throw with a generic 500 that leaks nothing", () => {
      const res = mockRes();
      vi.spyOn(console, "error").mockImplementation(() => {});

      errorHandler(
        new Error("connection string postgres://user:pw@host/db refused"),
        mockReq("GET", "/api/x"),
        res,
        vi.fn(),
      );

      expect(res.statusCode).toBe(500);
      expect(res.body).toMatchObject({
        success: false,
        statusCode: 500,
        message: "Internal Server Error",
        responseObject: null,
      });
      expect(JSON.stringify(res.body)).not.toContain("pw@host");
    });

    it("ignores a status outside the HTTP range rather than trusting it", () => {
      const res = mockRes();
      const err = Object.assign(new Error("nonsense"), { status: 42 });
      vi.spyOn(console, "error").mockImplementation(() => {});

      errorHandler(err, mockReq("GET", "/api/x"), res, vi.fn());

      expect(res.statusCode).toBe(500);
    });

    it("handles a thrown value that is not an Error", () => {
      const res = mockRes();
      vi.spyOn(console, "error").mockImplementation(() => {});

      errorHandler("a plain string failure", mockReq("GET", "/api/x"), res, vi.fn());

      expect(res.statusCode).toBe(500);
      expect(res.body).toMatchObject({ message: "Internal Server Error" });
    });

    it("falls back to a generic message for a non-Error 4xx", () => {
      const res = mockRes();
      vi.spyOn(console, "error").mockImplementation(() => {});

      errorHandler(
        { status: 400 },
        mockReq("GET", "/api/x"),
        res,
        vi.fn(),
      );

      expect(res.statusCode).toBe(400);
      expect(res.body).toMatchObject({ message: "Bad Request" });
    });
  });
});
