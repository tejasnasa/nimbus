/**
 * @module web/tests/unit/hooks/useWorkspaceJoinForm
 * @description Join-by-invite-code form: the POST to `/api/workspace/join`,
 * the redirect to the joined workspace's slugId, and the server-failure branch
 * (envelope `success: false`) landing on the root form error.
 */
import { act, renderHook } from "@testing-library/react";
import { http, HttpResponse, type DefaultBodyType } from "msw";
import type { ChangeEvent } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BACKEND_URL, fail, ok } from "../../msw/handlers";
import { server } from "../../msw/server";
import { useWorkspaceJoinForm } from "../../../hooks/useWorkspaceJoinForm";

process.env.NEXT_PUBLIC_BACKEND_URL = BACKEND_URL;

const { routerMock } = vi.hoisted(() => ({
  routerMock: { push: vi.fn(), refresh: vi.fn(), replace: vi.fn() },
}));

vi.mock("next/navigation", () => ({ useRouter: () => routerMock }));

const change = (name: string, value: string) =>
  ({ target: { name, value } }) as unknown as ChangeEvent<HTMLInputElement>;

const JOIN_URL = `${BACKEND_URL}/api/workspace/join`;

describe("useWorkspaceJoinForm", () => {
  beforeEach(() => {
    routerMock.push.mockClear();
  });

  it("starts idle with no error and no navigation", () => {
    const { result } = renderHook(() => useWorkspaceJoinForm());

    expect(result.current.firstError).toBeUndefined();
    expect(result.current.isSubmitting).toBe(false);
    expect(routerMock.push).not.toHaveBeenCalled();
  });

  it("posts the invite code and routes to the joined workspace", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(JOIN_URL, async ({ request }) => {
        bodies.push(await request.json());
        return ok({ slug: "test-workspace", slugId: 12 }, "Joined workspace");
      }),
    );

    const { result } = renderHook(() => useWorkspaceJoinForm());
    act(() => {
      result.current
        .register("inviteCode")
        .onChange(change("inviteCode", "invite-code"));
    });

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(bodies).toEqual([{ inviteCode: "invite-code" }]);
    expect(routerMock.push).toHaveBeenCalledWith("/workspace/12");
    expect(result.current.firstError).toBeUndefined();
  });

  it("routes on slugId, not on the workspace id", async () => {
    server.use(
      http.post(JOIN_URL, () => ok({ slug: "s", slugId: 99 }, "Joined")),
    );

    const { result } = renderHook(() => useWorkspaceJoinForm());
    act(() => {
      result.current.register("inviteCode").onChange(change("inviteCode", "x"));
    });

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(routerMock.push).toHaveBeenCalledWith("/workspace/99");
  });

  it("surfaces the envelope message when the invite code is rejected", async () => {
    server.use(
      http.post(JOIN_URL, () => fail(404, "Invalid invite code")),
    );

    const { result } = renderHook(() => useWorkspaceJoinForm());
    act(() => {
      result.current
        .register("inviteCode")
        .onChange(change("inviteCode", "expired"));
    });

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(result.current.firstError).toBe("Invalid invite code");
    expect(routerMock.push).not.toHaveBeenCalled();
  });

  it("falls back to a generic root error when the 500 body has no message", async () => {
    server.use(
      http.post(JOIN_URL, () =>
        HttpResponse.json({ success: false }, { status: 500 }),
      ),
    );

    const { result } = renderHook(() => useWorkspaceJoinForm());
    act(() => {
      result.current.register("inviteCode").onChange(change("inviteCode", "x"));
    });

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(result.current.firstError).toBe(
      "Something went wrong. Please try again.",
    );
    expect(routerMock.push).not.toHaveBeenCalled();
  });

  it("sends a blank invite code to the API — the schema does not gate on content", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(JOIN_URL, async ({ request }) => {
        bodies.push(await request.json());
        return fail(404, "Invalid invite code");
      }),
    );

    const { result } = renderHook(() => useWorkspaceJoinForm());

    await act(async () => {
      await result.current.onSubmit();
    });

    // `workspaceJoinSchema` only checks the type, so an empty field is a
    // round-trip the server has to reject.
    expect(bodies).toEqual([{ inviteCode: "" }]);
    expect(result.current.firstError).toBe("Invalid invite code");
  });

  it("reports isSubmitting while the join request is pending", async () => {
    let release: (() => void) | undefined;
    let submit: Promise<void>;
    server.use(
      http.post(
        JOIN_URL,
        () =>
          new Promise<HttpResponse<DefaultBodyType>>((resolve) => {
            release = () => resolve(ok({ slug: "s", slugId: 2 }, "Joined"));
          }),
      ),
    );

    const { result } = renderHook(() => useWorkspaceJoinForm());
    act(() => {
      result.current.register("inviteCode").onChange(change("inviteCode", "x"));
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
});
