/**
 * @module web/tests/unit/hooks/useWorkspaceForm
 * @description Create-workspace form behaviour: Zod validation surfaced
 * through `firstError`, the POST to `/api/workspace/create`, the redirect to
 * the new workspace, and server failures landing on the root form error.
 *
 * `next/navigation` is mocked because the hook routes on success, and `msw`
 * serves the API so the failure branch is exercised against a real envelope
 * (`success: false`) rather than a stub that can only return success.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse, type DefaultBodyType } from "msw";
import type { ChangeEvent } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BACKEND_URL, fail } from "../../msw/handlers";
import { server } from "../../msw/server";
import { useWorkspaceForm } from "../../../hooks/useWorkspaceForm";

process.env.NEXT_PUBLIC_BACKEND_URL = BACKEND_URL;

const { routerMock } = vi.hoisted(() => ({
  routerMock: { push: vi.fn(), refresh: vi.fn(), replace: vi.fn() },
}));

vi.mock("next/navigation", () => ({ useRouter: () => routerMock }));

/** Minimal change-event stand-in, so fields can be driven without a DOM input. */
const change = (name: string, value: string) =>
  ({ target: { name, value } }) as unknown as ChangeEvent<HTMLInputElement>;

const CREATE_URL = `${BACKEND_URL}/api/workspace/create`;

describe("useWorkspaceForm", () => {
  beforeEach(() => {
    routerMock.push.mockClear();
    routerMock.refresh.mockClear();
  });

  it("starts with no error and a registered name field", () => {
    const { result } = renderHook(() => useWorkspaceForm());

    expect(result.current.firstError).toBeUndefined();
    expect(result.current.register("name").name).toBe("name");
    expect(result.current.isSubmitting).toBe(false);
  });

  it("rejects a name shorter than 3 characters without calling the API", async () => {
    const createSpy = vi.fn();
    server.use(
      http.post(CREATE_URL, () => {
        createSpy();
        return HttpResponse.json({ success: true, responseObject: {} });
      }),
    );

    const { result } = renderHook(() => useWorkspaceForm());
    act(() => {
      result.current.register("name").onChange(change("name", "ab"));
    });

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(result.current.firstError).toBe(
      "Workspace name must be at least 3 characters",
    );
    expect(createSpy).not.toHaveBeenCalled();
    expect(routerMock.push).not.toHaveBeenCalled();
  });

  it("rejects a name longer than 25 characters", async () => {
    const { result } = renderHook(() => useWorkspaceForm());
    act(() => {
      result.current
        .register("name")
        .onChange(change("name", "x".repeat(26)));
    });

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(result.current.firstError).toBe(
      "Workspace name must be at most 25 characters",
    );
  });

  it("rejects a description longer than 255 characters", async () => {
    const { result } = renderHook(() => useWorkspaceForm());
    act(() => {
      result.current.register("name").onChange(change("name", "Team Alpha"));
      result.current
        .register("description")
        .onChange(change("description", "d".repeat(256)));
    });

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(result.current.firstError).toBe(
      "Description must be at most 255 characters",
    );
  });

  it("posts the validated payload and routes to the created workspace", async () => {
    const seen: Array<{ method?: string; body?: unknown }> = [];
    server.use(
      http.post(CREATE_URL, async ({ request }) => {
        seen.push({ method: request.method, body: await request.json() });
        return HttpResponse.json(
          {
            success: true,
            message: "Workspace created",
            responseObject: {
              workspaceId: "cm_workspace_0000000000000",
              name: "Team Alpha",
              slug: "team-alpha",
              slugId: 42,
              creatorId: "user-1",
              inviteCode: "invite-code",
            },
            statusCode: 201,
          },
          { status: 201 },
        );
      }),
    );

    const { result } = renderHook(() => useWorkspaceForm());
    act(() => {
      result.current.register("name").onChange(change("name", "Team Alpha"));
    });

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.method).toBe("POST");
    expect(seen[0]?.body).toEqual({ name: "Team Alpha", description: "" });
    expect(routerMock.push).toHaveBeenCalledWith("/workspace/42");
    expect(result.current.firstError).toBeUndefined();
  });

  it("routes to the slugId from the response envelope, not the workspace id", async () => {
    server.use(
      http.post(CREATE_URL, () =>
        HttpResponse.json({
          success: true,
          message: "Workspace created",
          responseObject: { workspaceId: "cm_abc", slugId: 7 },
          statusCode: 201,
        }),
      ),
    );

    const { result } = renderHook(() => useWorkspaceForm());
    act(() => {
      result.current.register("name").onChange(change("name", "Team Alpha"));
    });

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(routerMock.push).toHaveBeenCalledWith("/workspace/7");
  });

  it("surfaces the envelope message as the root error when the API rejects", async () => {
    server.use(
      http.post(CREATE_URL, () => fail(400, "Workspace name already taken")),
    );

    const { result } = renderHook(() => useWorkspaceForm());
    act(() => {
      result.current.register("name").onChange(change("name", "Team Alpha"));
    });

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(result.current.firstError).toBe("Workspace name already taken");
    expect(routerMock.push).not.toHaveBeenCalled();
  });

  it("does not navigate when a 500 carries no message field", async () => {
    server.use(
      http.post(CREATE_URL, () =>
        HttpResponse.json({ success: false, statusCode: 500 }, { status: 500 }),
      ),
    );

    const { result } = renderHook(() => useWorkspaceForm());
    act(() => {
      result.current.register("name").onChange(change("name", "Team Alpha"));
    });

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(routerMock.push).not.toHaveBeenCalled();
    expect(result.current.firstError).toBe(
      "Something went wrong. Please try again.",
    );
  });

  it("falls back to a generic message when the request never completes", async () => {
    server.use(
      http.post(CREATE_URL, () => HttpResponse.error()),
    );
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue({} as never);

    const { result } = renderHook(() => useWorkspaceForm());
    act(() => {
      result.current.register("name").onChange(change("name", "Team Alpha"));
    });

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(result.current.firstError).toBe(
      "Something went wrong. Please try again.",
    );
    expect(routerMock.push).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("reports isSubmitting while the request is in flight and clears it after", async () => {
    let release: (() => void) | undefined;
    server.use(
      http.post(
        CREATE_URL,
        () =>
          new Promise<HttpResponse<DefaultBodyType>>((resolve) => {
            release = () =>
              resolve(
                HttpResponse.json({
                  success: true,
                  responseObject: { slugId: 3 },
                  statusCode: 201,
                }),
              );
          }),
      ),
    );

    const { result } = renderHook(() => useWorkspaceForm());
    act(() => {
      result.current.register("name").onChange(change("name", "Team Alpha"));
    });

    let submit: Promise<void>;
    await act(async () => {
      submit = result.current.onSubmit();
    });

    await waitFor(() => expect(result.current.isSubmitting).toBe(true));

    await act(async () => {
      release?.();
      await submit;
    });

    expect(result.current.isSubmitting).toBe(false);
    expect(routerMock.push).toHaveBeenCalledWith("/workspace/3");
  });
});
