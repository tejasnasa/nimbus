/**
 * @module web/tests/unit/hooks/useWorkspacePermissions
 * @description Danger-zone actions: invite-code rotation, workspace deletion
 * (which routes to `/home`), and clipboard copy. Loading is keyed by action,
 * and every failure surfaces through `alert`.
 */
import { act, renderHook } from "@testing-library/react";
import { http, HttpResponse, type DefaultBodyType } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BACKEND_URL, fail, ok } from "../../msw/handlers";
import { server } from "../../msw/server";
import { useWorkspacePermissions } from "../../../hooks/useWorkspacePermissions";

process.env.NEXT_PUBLIC_BACKEND_URL = BACKEND_URL;

const { routerMock } = vi.hoisted(() => ({
  routerMock: { push: vi.fn(), refresh: vi.fn(), replace: vi.fn() },
}));

vi.mock("next/navigation", () => ({ useRouter: () => routerMock }));

const alertMock = vi.fn();
const WORKSPACE_ID = "cm_workspace_0000000000000";
const REGENERATE_URL = `${BACKEND_URL}/api/workspace/regenerate-invite/${WORKSPACE_ID}`;
const DELETE_URL = `${BACKEND_URL}/api/workspace/delete/${WORKSPACE_ID}`;

describe("useWorkspacePermissions", () => {
  beforeEach(() => {
    vi.stubGlobal("alert", alertMock);
    routerMock.push.mockClear();
    routerMock.refresh.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("starts with no action in flight", () => {
    const { result } = renderHook(() =>
      useWorkspacePermissions(WORKSPACE_ID),
    );

    expect(result.current.loading).toBeNull();
  });

  it("rotates the invite code with a PUT and reports no error", async () => {
    const methods: string[] = [];
    server.use(
      http.put(REGENERATE_URL, ({ request }) => {
        methods.push(request.method);
        return ok({ inviteCode: "rotated-code" }, "Invite code regenerated");
      }),
    );

    const { result } = renderHook(() =>
      useWorkspacePermissions(WORKSPACE_ID),
    );

    await act(async () => {
      await result.current.handleRegenerateInviteCode();
    });

    expect(methods).toEqual(["PUT"]);
    expect(alertMock).not.toHaveBeenCalled();
    expect(result.current.loading).toBeNull();
  });

  it.fails(
    "refreshes the route after rotating the invite code so the UI drops the stale code",
    async () => {
      // The rotation invalidates the previous code, but the code the UI shows
      // and copies comes from the server-rendered `workspace` prop.
      server.use(
        http.put(REGENERATE_URL, () =>
          ok({ inviteCode: "rotated-code" }, "Invite code regenerated"),
        ),
      );

      const { result } = renderHook(() =>
        useWorkspacePermissions(WORKSPACE_ID),
      );

      await act(async () => {
        await result.current.handleRegenerateInviteCode();
      });

      expect(routerMock.refresh).toHaveBeenCalled();
    },
  );

  it("alerts the envelope message when rotation is refused", async () => {
    server.use(
      http.put(REGENERATE_URL, () =>
        fail(403, "Only admins can rotate the invite code"),
      ),
    );

    const { result } = renderHook(() =>
      useWorkspacePermissions(WORKSPACE_ID),
    );

    await act(async () => {
      await result.current.handleRegenerateInviteCode();
    });

    expect(alertMock).toHaveBeenCalledWith(
      "Only admins can rotate the invite code",
    );
    expect(result.current.loading).toBeNull();
  });

  it("deletes the workspace and routes home", async () => {
    const methods: string[] = [];
    server.use(
      http.delete(DELETE_URL, ({ request }) => {
        methods.push(request.method);
        return ok(null, "Workspace deleted");
      }),
    );

    const { result } = renderHook(() =>
      useWorkspacePermissions(WORKSPACE_ID),
    );

    await act(async () => {
      await result.current.handleDeleteWorkspace();
    });

    expect(methods).toEqual(["DELETE"]);
    expect(routerMock.push).toHaveBeenCalledWith("/home");
    expect(alertMock).not.toHaveBeenCalled();
  });

  it("does not navigate when deletion is refused", async () => {
    server.use(
      http.delete(DELETE_URL, () =>
        fail(403, "Only the owner can delete this workspace"),
      ),
    );

    const { result } = renderHook(() =>
      useWorkspacePermissions(WORKSPACE_ID),
    );

    await act(async () => {
      await result.current.handleDeleteWorkspace();
    });

    expect(alertMock).toHaveBeenCalledWith(
      "Only the owner can delete this workspace",
    );
    expect(routerMock.push).not.toHaveBeenCalled();
  });

  it("uses the generic alert fallback when a deletion failure has no message", async () => {
    server.use(
      http.delete(DELETE_URL, () =>
        HttpResponse.json({ success: false }, { status: 500 }),
      ),
    );

    const { result } = renderHook(() =>
      useWorkspacePermissions(WORKSPACE_ID),
    );

    await act(async () => {
      await result.current.handleDeleteWorkspace();
    });

    expect(alertMock).toHaveBeenCalledWith("Failed to delete workspace");
    expect(routerMock.push).not.toHaveBeenCalled();
  });

  it("keys the loading flag to the action in flight", async () => {
    let release: (() => void) | undefined;
    server.use(
      http.delete(
        DELETE_URL,
        () =>
          new Promise<HttpResponse<DefaultBodyType>>((resolve) => {
            release = () => resolve(ok(null, "Workspace deleted"));
          }),
      ),
    );

    const { result } = renderHook(() =>
      useWorkspacePermissions(WORKSPACE_ID),
    );

    let pending: Promise<void>;
    await act(async () => {
      pending = result.current.handleDeleteWorkspace();
    });

    expect(result.current.loading).toBe("delete");

    await act(async () => {
      release?.();
      await pending;
    });

    expect(result.current.loading).toBeNull();
  });

  it("marks the regenerate action as loading while it is in flight", async () => {
    let release: (() => void) | undefined;
    server.use(
      http.put(
        REGENERATE_URL,
        () =>
          new Promise<HttpResponse<DefaultBodyType>>((resolve) => {
            release = () => resolve(ok({ inviteCode: "rotated-code" }));
          }),
      ),
    );

    const { result } = renderHook(() =>
      useWorkspacePermissions(WORKSPACE_ID),
    );

    let pending: Promise<void>;
    await act(async () => {
      pending = result.current.handleRegenerateInviteCode();
    });

    expect(result.current.loading).toBe("regenerate");

    await act(async () => {
      release?.();
      await pending;
    });

    expect(result.current.loading).toBeNull();
  });

  it("copies the invite code and confirms it to the user", async () => {
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useWorkspacePermissions(WORKSPACE_ID),
    );

    await act(async () => {
      result.current.handleCopyInviteCode("invite-code");
    });

    expect(writeText).toHaveBeenCalledWith("invite-code");
    expect(alertMock).toHaveBeenCalledWith("Invite code copied to clipboard!");
  });
});
