/**
 * @module web/tests/unit/hooks/useWorkspaceDocuments
 * @description Document deletion: the DELETE to `/api/document/:docId`, the
 * `router.refresh()` that re-reads the lists, per-document loading state, and
 * the inline `error` / `notice` state. `alert` is stubbed to throw and
 * `window.location.reload` to fail, so either being used fails the test.
 */
import { act, renderHook } from "@testing-library/react";
import { http, HttpResponse, type DefaultBodyType } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BACKEND_URL, fail, ok } from "../../msw/handlers";
import { server } from "../../msw/server";
import { useWorkspaceDocuments } from "../../../hooks/useWorkspaceDocuments";

process.env.NEXT_PUBLIC_BACKEND_URL = BACKEND_URL;

const alertMock = vi.fn(() => {
  throw new Error("alert() must not be used for user feedback");
});
const reloadMock = vi.fn(() => {
  throw new Error("a full-page reload must not be used to refresh the lists");
});

const { routerMock } = vi.hoisted(() => ({
  routerMock: { push: vi.fn(), refresh: vi.fn(), replace: vi.fn() },
}));

vi.mock("next/navigation", () => ({ useRouter: () => routerMock }));

describe("useWorkspaceDocuments", () => {
  beforeEach(() => {
    vi.stubGlobal("alert", alertMock);
    vi.spyOn(window.location, "reload").mockImplementation(reloadMock);
    routerMock.refresh.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("starts with no document in flight", () => {
    const { result } = renderHook(() => useWorkspaceDocuments());

    expect(result.current.loading).toBeNull();
  });

  it("deletes the document and refreshes the route so the lists re-render", async () => {
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
    expect(routerMock.refresh).toHaveBeenCalledTimes(1);
    expect(reloadMock).not.toHaveBeenCalled();
    expect(alertMock).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
    expect(result.current.notice).toBe("Document deleted.");
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

  it("returns the envelope message as error and does not refresh when deletion fails", async () => {
    server.use(
      http.delete(`${BACKEND_URL}/api/document/:docId`, () =>
        fail(403, "You cannot delete this document"),
      ),
    );

    const { result } = renderHook(() => useWorkspaceDocuments());

    await act(async () => {
      await result.current.handleDeleteDocument("cm_document_00000000000000");
    });

    expect(result.current.error).toBe("You cannot delete this document");
    expect(result.current.notice).toBeNull();
    expect(routerMock.refresh).not.toHaveBeenCalled();
  });

  it("falls back to a generic error message when the failure body carries no message", async () => {
    server.use(
      http.delete(`${BACKEND_URL}/api/document/:docId`, () =>
        HttpResponse.json({ success: false, statusCode: 500 }, { status: 500 }),
      ),
    );

    const { result } = renderHook(() => useWorkspaceDocuments());

    await act(async () => {
      await result.current.handleDeleteDocument("cm_document_00000000000000");
    });

    expect(result.current.error).toBe("Failed to delete document");
    expect(routerMock.refresh).not.toHaveBeenCalled();
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
    expect(result.current.error).toBe("Document not found");
  });
});
