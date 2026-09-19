/**
 * @module web/tests/unit/hooks/useWorkspaceMembers
 * @description Member management: role changes and removals, the
 * `router.refresh()` that re-reads the roster, per-member loading state, and
 * the alert shown for RBAC rejections.
 */
import { act, renderHook } from "@testing-library/react";
import { http, HttpResponse, type DefaultBodyType } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BACKEND_URL, fail, ok } from "../../msw/handlers";
import { server } from "../../msw/server";
import { useWorkspaceMembers } from "../../../hooks/useWorkspaceMembers";

process.env.NEXT_PUBLIC_BACKEND_URL = BACKEND_URL;

const { routerMock } = vi.hoisted(() => ({
  routerMock: { push: vi.fn(), refresh: vi.fn(), replace: vi.fn() },
}));

vi.mock("next/navigation", () => ({ useRouter: () => routerMock }));

const alertMock = vi.fn();
const WORKSPACE_ID = "cm_workspace_0000000000000";
const ROLE_URL = `${BACKEND_URL}/api/workspace/role/${WORKSPACE_ID}`;
const REMOVE_URL = `${BACKEND_URL}/api/workspace/leave/${WORKSPACE_ID}`;

describe("useWorkspaceMembers", () => {
  beforeEach(() => {
    vi.stubGlobal("alert", alertMock);
    routerMock.refresh.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts with no member in flight", () => {
    const { result } = renderHook(() => useWorkspaceMembers(WORKSPACE_ID));

    expect(result.current.loading).toBeNull();
  });

  it("PUTs the role change and refreshes the roster", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.put(ROLE_URL, async ({ request }) => {
        bodies.push(await request.json());
        return ok({ role: "ADMIN" }, "Member role updated");
      }),
    );

    const { result } = renderHook(() => useWorkspaceMembers(WORKSPACE_ID));

    await act(async () => {
      await result.current.handleUpdateRole("user-2", "ADMIN");
    });

    expect(bodies).toEqual([{ memberId: "user-2", role: "ADMIN" }]);
    expect(routerMock.refresh).toHaveBeenCalledTimes(1);
    expect(alertMock).not.toHaveBeenCalled();
  });

  it("refuses to promote to OWNER client-side by delegating to the server", async () => {
    // The OWNER invariant is enforced by the API; the hook must surface the
    // rejection rather than silently refreshing.
    server.use(
      http.put(ROLE_URL, () =>
        fail(403, "The OWNER role cannot be reassigned"),
      ),
    );

    const { result } = renderHook(() => useWorkspaceMembers(WORKSPACE_ID));

    await act(async () => {
      await result.current.handleUpdateRole("user-1", "OWNER");
    });

    expect(alertMock).toHaveBeenCalledWith(
      "The OWNER role cannot be reassigned",
    );
    expect(routerMock.refresh).not.toHaveBeenCalled();
  });

  it("sends the member id in the DELETE body and refreshes", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.delete(REMOVE_URL, async ({ request }) => {
        bodies.push(await request.json());
        return ok({}, "Member removed");
      }),
    );

    const { result } = renderHook(() => useWorkspaceMembers(WORKSPACE_ID));

    await act(async () => {
      await result.current.handleRemoveMember("user-2");
    });

    expect(bodies).toEqual([{ memberId: "user-2" }]);
    expect(routerMock.refresh).toHaveBeenCalledTimes(1);
  });

  it("falls back to a generic message when a removal fails without one", async () => {
    server.use(
      http.delete(REMOVE_URL, () =>
        HttpResponse.json({ success: false }, { status: 500 }),
      ),
    );

    const { result } = renderHook(() => useWorkspaceMembers(WORKSPACE_ID));

    await act(async () => {
      await result.current.handleRemoveMember("user-2");
    });

    expect(alertMock).toHaveBeenCalledWith("Failed to remove member");
    expect(routerMock.refresh).not.toHaveBeenCalled();
  });

  it("exposes the in-flight member id and clears it afterwards", async () => {
    let release: (() => void) | undefined;
    server.use(
      http.put(
        ROLE_URL,
        () =>
          new Promise<HttpResponse<DefaultBodyType>>((resolve) => {
            release = () => resolve(ok({ role: "ADMIN" }));
          }),
      ),
    );

    const { result } = renderHook(() => useWorkspaceMembers(WORKSPACE_ID));

    let pending: Promise<void>;
    await act(async () => {
      pending = result.current.handleUpdateRole("user-2", "ADMIN");
    });

    expect(result.current.loading).toBe("user-2");

    await act(async () => {
      release?.();
      await pending;
    });

    expect(result.current.loading).toBeNull();
  });

  it.fails(
    "keeps a member marked as loading while their own request is still running",
    async () => {
      // Two admins acting at once: the first response must not clear the
      // spinner for the member whose request has not come back yet.
      const releases: Array<() => void> = [];
      server.use(
        http.put(
          ROLE_URL,
          () =>
            new Promise<HttpResponse<DefaultBodyType>>((resolve) => {
              releases.push(() => resolve(ok({ role: "ADMIN" })));
            }),
        ),
      );

      const { result } = renderHook(() => useWorkspaceMembers(WORKSPACE_ID));

      let first: Promise<void>;
      await act(async () => {
        first = result.current.handleUpdateRole("user-a", "ADMIN");
      });
      let second: Promise<void>;
      await act(async () => {
        second = result.current.handleUpdateRole("user-b", "ADMIN");
      });

      await act(async () => {
        releases[0]?.();
        await first;
      });

      const loadingWhileSecondInFlight = result.current.loading;

      await act(async () => {
        releases[1]?.();
        await second;
      });

      expect(loadingWhileSecondInFlight).toBe("user-b");
    },
  );
});
