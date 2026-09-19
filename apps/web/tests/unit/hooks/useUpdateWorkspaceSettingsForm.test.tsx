/**
 * @module web/tests/unit/hooks/useUpdateWorkspaceSettingsForm
 * @description Workspace rename/description form: defaults seeded from the
 * current workspace, dirty tracking, the PUT to `/api/workspace/update/:id`,
 * the `router.refresh()` that pulls the new values, and the failure branch.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse, type DefaultBodyType } from "msw";
import type { ChangeEvent } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Workspace } from "@nimbus/types";
import { BACKEND_URL, fail, ok } from "../../msw/handlers";
import { server } from "../../msw/server";
import { useUpdateWorkspaceSettingsForm } from "../../../hooks/useUpdateWorkspaceSettingsForm";

process.env.NEXT_PUBLIC_BACKEND_URL = BACKEND_URL;

const { routerMock } = vi.hoisted(() => ({
  routerMock: { push: vi.fn(), refresh: vi.fn(), replace: vi.fn() },
}));

vi.mock("next/navigation", () => ({ useRouter: () => routerMock }));

const change = (name: string, value: string) =>
  ({ target: { name, value } }) as unknown as ChangeEvent<HTMLInputElement>;

const WORKSPACE: Workspace = {
  id: "cm_workspace_0000000000000",
  name: "Test Workspace",
  description: "Original description",
  slug: "test-workspace",
  slugId: 1,
  inviteCode: "invite-code",
  updatedAt: "2026-01-01T00:00:00.000Z",
  members: [],
};

const UPDATE_URL = `${BACKEND_URL}/api/workspace/update/${WORKSPACE.id}`;

describe("useUpdateWorkspaceSettingsForm", () => {
  beforeEach(() => {
    routerMock.refresh.mockClear();
  });

  it("seeds the form from the workspace and starts clean", () => {
    const { result } = renderHook(() =>
      useUpdateWorkspaceSettingsForm(WORKSPACE),
    );

    expect(result.current.register("name").name).toBe("name");
    expect(result.current.isDirty).toBe(false);
    expect(result.current.firstError).toBeUndefined();
  });

  it("PUTs the edited values and refreshes the route", async () => {
    const requests: Array<{ method?: string; body: unknown }> = [];
    server.use(
      http.put(UPDATE_URL, async ({ request }) => {
        requests.push({ method: request.method, body: await request.json() });
        return ok({}, "Workspace updated");
      }),
    );

    const { result } = renderHook(() =>
      useUpdateWorkspaceSettingsForm(WORKSPACE),
    );
    act(() => {
      result.current
        .register("name")
        .onChange(change("name", "Renamed Workspace"));
    });

    await waitFor(() => expect(result.current.isDirty).toBe(true));

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(requests).toEqual([
      {
        method: "PUT",
        body: { name: "Renamed Workspace", description: "Original description" },
      },
    ]);
    expect(routerMock.refresh).toHaveBeenCalledTimes(1);
    expect(result.current.firstError).toBeUndefined();
  });

  it("clears the dirty flag after a successful save", async () => {
    server.use(http.put(UPDATE_URL, () => ok({}, "Workspace updated")));

    const { result } = renderHook(() =>
      useUpdateWorkspaceSettingsForm(WORKSPACE),
    );
    act(() => {
      result.current.register("name").onChange(change("name", "Renamed"));
    });

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(result.current.isDirty).toBe(false);
  });

  it("surfaces the envelope message on an RBAC rejection and does not refresh", async () => {
    server.use(
      http.put(UPDATE_URL, () => fail(403, "Access denied")),
    );

    const { result } = renderHook(() =>
      useUpdateWorkspaceSettingsForm(WORKSPACE),
    );
    act(() => {
      result.current.register("name").onChange(change("name", "Renamed"));
    });

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(result.current.firstError).toBe("Access denied");
    expect(routerMock.refresh).not.toHaveBeenCalled();
  });

  it("keeps the form dirty when the save fails", async () => {
    server.use(http.put(UPDATE_URL, () => fail(500, "Boom")));

    const { result } = renderHook(() =>
      useUpdateWorkspaceSettingsForm(WORKSPACE),
    );
    act(() => {
      result.current.register("name").onChange(change("name", "Renamed"));
    });

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(result.current.isDirty).toBe(true);
  });

  it("reports isSubmitting while the save is in flight", async () => {
    let release: (() => void) | undefined;
    let submit: Promise<void>;
    server.use(
      http.put(
        UPDATE_URL,
        () =>
          new Promise<HttpResponse<DefaultBodyType>>((resolve) => {
            release = () => resolve(ok({}, "Workspace updated"));
          }),
      ),
    );

    const { result } = renderHook(() =>
      useUpdateWorkspaceSettingsForm(WORKSPACE),
    );
    act(() => {
      result.current.register("name").onChange(change("name", "Renamed"));
    });

    await act(async () => {
      submit = result.current.onSubmit();
    });

    expect(result.current.isSubmitting).toBe(true);

    await act(async () => {
      release?.();
      await submit;
    });

    expect(result.current.isSubmitting).toBe(false);
  });

  it("rejects a blank name before reaching the API", async () => {
    const spy = vi.fn();
    server.use(
      http.put(UPDATE_URL, () => {
        spy();
        return ok({}, "Workspace updated");
      }),
    );

    const { result } = renderHook(() =>
      useUpdateWorkspaceSettingsForm(WORKSPACE),
    );
    act(() => {
      result.current.register("name").onChange(change("name", ""));
    });

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(spy).not.toHaveBeenCalled();
    expect(result.current.firstError).toBe(
      "Workspace name must be at least 3 characters",
    );
  });

  it("reports a network failure as a root error instead of refreshing", async () => {
    server.use(
      http.put(UPDATE_URL, () => HttpResponse.json({}, { status: 502 })),
    );

    const { result } = renderHook(() =>
      useUpdateWorkspaceSettingsForm(WORKSPACE),
    );
    act(() => {
      result.current.register("name").onChange(change("name", "Renamed"));
    });

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(routerMock.refresh).not.toHaveBeenCalled();
    expect(result.current.firstError).toBeDefined();
  });
});
