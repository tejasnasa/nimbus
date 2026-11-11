/**
 * @module web/tests/unit/lib/documentApi
 * @description The browser-side document read: what it requests, how a document
 * maps to the editor's shape (canvas elements kept, anything else emptied), and
 * that every failure becomes null instead of a throw.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  exportDocument,
  fetchDocument,
  renameDocument,
  searchDocuments,
} from "../../../lib/documentApi";

const fetchMock = vi.fn();

const response = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as Response;

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  process.env.NEXT_PUBLIC_BACKEND_URL = "http://api.test";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("lib/documentApi", () => {
  it("reads a document with the session cookie and maps it for the editor", async () => {
    const elements = [{ id: "e1" }];
    fetchMock.mockResolvedValue(
      response({
        responseObject: {
          id: "d/1",
          title: "Sketch",
          type: "CANVAS",
          canvasData: elements,
          yjsState: null,
        },
      }),
    );

    const doc = await fetchDocument("d/1");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://api.test/api/document/d%2F1");
    expect(init.credentials).toBe("include");
    expect(doc).toEqual({
      id: "d/1",
      label: "Sketch",
      type: "CANVAS",
      elements,
      yjsState: null,
    });
  });

  it("gives a markdown document no canvas elements", async () => {
    fetchMock.mockResolvedValue(
      response({
        responseObject: {
          id: "d1",
          title: "Notes",
          type: "MARKDOWN",
          canvasData: { not: "an array" },
          yjsState: null,
        },
      }),
    );

    expect(await fetchDocument("d1")).toMatchObject({ elements: [] });
  });

  it("returns null for a refusal, an unreadable body and a network failure", async () => {
    fetchMock.mockResolvedValueOnce(response({}, 403));
    expect(await fetchDocument("d1")).toBeNull();

    fetchMock.mockResolvedValueOnce(response({ responseObject: null }));
    expect(await fetchDocument("d1")).toBeNull();

    fetchMock.mockRejectedValueOnce(new Error("offline"));
    expect(await fetchDocument("d1")).toBeNull();
  });
});

describe("lib/documentApi: rename, export and search", () => {
  it("renames with PATCH, a JSON body and the session cookie", async () => {
    fetchMock.mockResolvedValue(
      response({ success: true, responseObject: { id: "d/1", title: "New" } }),
    );

    const result = await renameDocument("d/1", "New");

    expect(result).toEqual({ ok: true, data: { id: "d/1", title: "New" } });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://api.test/api/document/d%2F1");
    expect(init).toMatchObject({
      method: "PATCH",
      credentials: "include",
      body: JSON.stringify({ title: "New" }),
      headers: { "content-type": "application/json" },
    });
  });

  it("reads an export without a body header", async () => {
    fetchMock.mockResolvedValue(
      response({
        success: true,
        responseObject: { type: "MARKDOWN", title: "T", markdown: "x" },
      }),
    );

    const result = await exportDocument("d1");

    expect(result).toMatchObject({ ok: true, data: { markdown: "x" } });
    expect(fetchMock.mock.calls[0]![0]).toBe(
      "http://api.test/api/document/d1/export",
    );
    expect(fetchMock.mock.calls[0]![1].headers).toBeUndefined();
  });

  it("encodes the search query and workspace", async () => {
    fetchMock.mockResolvedValue(
      response({ success: true, responseObject: { hits: [] } }),
    );

    await searchDocuments("ws 1", 'a "b" & c');

    const url = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(url.pathname).toBe("/api/document/search");
    expect(url.searchParams.get("workspaceId")).toBe("ws 1");
    expect(url.searchParams.get("q")).toBe('a "b" & c');
  });

  it("turns a refusal into its message and status", async () => {
    fetchMock.mockResolvedValue(
      response({ success: false, message: "Document not found" }, 404),
    );

    expect(await renameDocument("d1", "x")).toEqual({
      ok: false,
      message: "Document not found",
      status: 404,
    });
  });

  it("falls back to a generic message for an empty failure or a network error", async () => {
    fetchMock.mockResolvedValueOnce(response({}, 500));
    expect(await exportDocument("d1")).toMatchObject({
      ok: false,
      message: "Something went wrong. Please try again.",
      status: 500,
    });

    fetchMock.mockRejectedValueOnce(new Error("offline"));
    expect(await searchDocuments("w", "q")).toEqual({
      ok: false,
      message: "Something went wrong. Please try again.",
      status: 0,
    });
  });
});
