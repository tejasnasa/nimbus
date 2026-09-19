/**
 * @module web/tests/unit/hooks/useWorkspaceDocuments
 * @description Document deletion: the DELETE to `/api/document/:docId`, the
 * full-page reload used to refresh tab/document lists, per-document loading
 * state, and the alert shown when deletion is refused.
 *
 * `window.location.reload` is spied on because happy-dom would otherwise tear
 * the document down mid-test.
 */
import { act, renderHook } from "@testing-library/react";
import { http, HttpResponse, type DefaultBodyType } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BACKEND_URL, fail, ok } from "../../msw/handlers";
import { server } from "../../msw/server";
import { useWorkspaceDocuments } from "../../../hooks/useWorkspaceDocuments";

process.env.NEXT_PUBLIC_BACKEND_URL = BACKEND_URL;

const alertMock = vi.fn();
const reloadMock = vi.fn();

describe("useWorkspaceDocuments", () => {
  beforeEach(() => {
    vi.stubGlobal("alert", alertMock);
    vi.spyOn(window.location, "reload").mockImplementation(reloadMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("starts with no document in flight", () => {
    const { result } = renderHook(() => useWorkspaceDocuments());

    expect(result.current.loading).toBeNull();
  });

  it("deletes the document and reloads the page so the lists refresh", async () => {
    const methods: string[] = [];
    server.use(
      http.delete(`${BACKEND_URL}/api/document/:docId`, ({ request }) => {
        methods.push(request.method);
        return ok("Document deleted", "Document deleted");
      }),
    );

    const { result } = renderHook(() => useWorkspaceDocuments());

    await act(async () => {
      await result.current.handleDeleteDocument("cm_document_00000000000000");
    });

    expect(methods).toEqual(["DELETE"]);
    expect(reloadMock).toHaveBeenCalledTimes(1);
    expect(alertMock).not.toHaveBeenCalled();
  });

  it("targets the document in the URL path", async () => {
    const urls: string[] = [];
    server.use(
      http.delete(`${BACKEND_URL}/api/document/:docId`, ({ request }) => {
        urls.push(new URL(request.url).pathname);
        return ok("Document deleted");
      }),
    );

    const { result } = renderHook(() => useWorkspaceDocuments());

    await act(async () => {
      await result.current.handleDeleteDocument("cm_target_document");
    });

    expect(urls).toEqual(["/api/document/cm_target_document"]);
  });

  it("alerts the envelope message and does not reload when deletion fails", async () => {
    server.use(
      http.delete(`${BACKEND_URL}/api/document/:docId`, () =>
        fail(403, "You cannot delete this document"),
      ),
    );

    const { result } = renderHook(() => useWorkspaceDocuments());

    await act(async () => {
      await result.current.handleDeleteDocument("cm_document_00000000000000");
    });

    expect(alertMock).toHaveBeenCalledWith("You cannot delete this document");
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it("falls back to a generic alert when the failure body carries no message", async () => {
    server.use(
      http.delete(`${BACKEND_URL}/api/document/:docId`, () =>
        HttpResponse.json({ success: false, statusCode: 500 }, { status: 500 }),
      ),
    );

    const { result } = renderHook(() => useWorkspaceDocuments());

    await act(async () => {
      await result.current.handleDeleteDocument("cm_document_00000000000000");
    });

    expect(alertMock).toHaveBeenCalledWith("Failed to delete document");
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it("tracks the in-flight document id and clears it afterwards", async () => {
    let release: (() => void) | undefined;
    server.use(
      http.delete(
        `${BACKEND_URL}/api/document/:docId`,
        () =>
          new Promise<HttpResponse<DefaultBodyType>>((resolve) => {
            release = () => resolve(ok("Document deleted"));
          }),
      ),
    );

    const { result } = renderHook(() => useWorkspaceDocuments());

    let pending: Promise<void>;
    await act(async () => {
      pending = result.current.handleDeleteDocument("cm_document_00000000000000");
    });

    expect(result.current.loading).toBe("cm_document_00000000000000");

    await act(async () => {
      release?.();
      await pending;
    });

    expect(result.current.loading).toBeNull();
  });

  it("clears the loading state even when the delete throws", async () => {
    server.use(
      http.delete(`${BACKEND_URL}/api/document/:docId`, () =>
        fail(404, "Document not found"),
      ),
    );

    const { result } = renderHook(() => useWorkspaceDocuments());

    await act(async () => {
      await result.current.handleDeleteDocument("missing");
    });

    expect(result.current.loading).toBeNull();
    expect(alertMock).toHaveBeenCalledWith("Document not found");
  });
});
