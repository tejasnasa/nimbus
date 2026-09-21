/**
 * @module web/tests/unit/hooks/useProfileForm
 * @description Profile edit form: the seed value, the `updateUser` call
 * shape, the dirty gating, the `router.refresh()` that re-renders server
 * components, and the failure branch that surfaces a root error rather
 * than silently losing the edit.
 *
 * `authClient.updateUser` is mocked at the module boundary (the file under
 * test imports the same singleton) so the test exercises the real call
 * shape without a running backend.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ChangeEvent } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BACKEND_URL } from "../../msw/handlers";

const { updateUserMock, routerMock } = vi.hoisted(() => ({
  updateUserMock: vi.fn(),
  routerMock: { push: vi.fn(), refresh: vi.fn(), replace: vi.fn() },
}));

vi.mock("next/navigation", () => ({ useRouter: () => routerMock }));

vi.mock("../../../lib/auth-client", () => ({
  authClient: { updateUser: updateUserMock },
}));

import { useProfileForm } from "../../../hooks/useProfileForm";

process.env.NEXT_PUBLIC_BACKEND_URL = BACKEND_URL;

const change = (name: string, value: string) =>
  ({ target: { name, value } }) as unknown as ChangeEvent<HTMLInputElement>;

const USER = { id: "user-1", name: "Ada Lovelace", image: null };

describe("useProfileForm", () => {
  beforeEach(() => {
    updateUserMock.mockReset();
    routerMock.refresh.mockClear();
  });

  it("seeds from the user and starts clean", () => {
    const { result } = renderHook(() => useProfileForm(USER));

    expect(result.current.register("name").name).toBe("name");
    expect(result.current.isDirty).toBe(false);
    expect(result.current.firstError).toBeUndefined();
  });

  it("calls updateUser with only the changed fields and refreshes the route", async () => {
    updateUserMock.mockImplementation(
      (_patch: unknown, opts?: { onSuccess?: () => void }) => {
        opts?.onSuccess?.();
        return Promise.resolve();
      },
    );

    const { result } = renderHook(() =>
      useProfileForm({ ...USER, image: "https://cdn/ada.png" }),
    );

    act(() => {
      result.current.register("name").onChange(change("name", "Augusta"));
    });

    await waitFor(() => expect(result.current.isDirty).toBe(true));

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(updateUserMock).toHaveBeenCalledTimes(1);
    expect(updateUserMock).toHaveBeenCalledWith(
      { name: "Augusta" },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
    expect(routerMock.refresh).toHaveBeenCalledTimes(1);
    expect(result.current.firstError).toBeUndefined();
  });

  it("forwards a new avatar image alongside a name edit when both change", async () => {
    updateUserMock.mockImplementation(
      (_patch: unknown, opts?: { onSuccess?: () => void }) => {
        opts?.onSuccess?.();
        return Promise.resolve();
      },
    );

    const { result } = renderHook(() =>
      useProfileForm({ ...USER, image: "https://cdn/old.png" }),
    );

    act(() => {
      result.current.register("name").onChange(change("name", "Augusta"));
      result.current.setValue("image", "https://cdn/new.png", {
        shouldDirty: true,
      });
    });

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(updateUserMock).toHaveBeenCalledWith(
      { name: "Augusta", image: "https://cdn/new.png" },
      expect.anything(),
    );
    expect(routerMock.refresh).toHaveBeenCalledTimes(1);
  });

  it("surfaces a server error as a root error and does not refresh", async () => {
    updateUserMock.mockImplementation(
      (
        _patch: unknown,
        opts?: { onError?: (ctx: { error: { message: string } }) => void },
      ) => {
        opts?.onError?.({ error: { message: "Email cannot be updated" } });
        return Promise.resolve();
      },
    );

    const { result } = renderHook(() => useProfileForm(USER));
    act(() => {
      result.current.register("name").onChange(change("name", "Augusta"));
    });

    await act(async () => {
      await result.current.onSubmit();
    });

    await waitFor(() =>
      expect(result.current.firstError).toBe("Email cannot be updated"),
    );
    expect(routerMock.refresh).not.toHaveBeenCalled();
  });

  it("rejects an empty name before reaching updateUser", async () => {
    const { result } = renderHook(() => useProfileForm(USER));
    act(() => {
      result.current.register("name").onChange(change("name", ""));
    });

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(updateUserMock).not.toHaveBeenCalled();
    expect(result.current.firstError).toBe("Name cannot be empty.");
  });

  it("does not refresh when nothing actually changed", async () => {
    updateUserMock.mockImplementation(
      (_patch: unknown, opts?: { onSuccess?: () => void }) => {
        opts?.onSuccess?.();
        return Promise.resolve();
      },
    );

    const { result } = renderHook(() => useProfileForm(USER));
    // Touch the field and put it back so RHF still registers it as dirty.
    act(() => {
      result.current.register("name").onChange(change("name", "X"));
    });
    act(() => {
      result.current.register("name").onChange(change("name", USER.name));
    });

    // RHF may still report dirty for a single cycle (the defaultValues
    // comparison). After submit the form should remain unchanged either way
    // — the gate inside the hook is the second layer of defence.
    await act(async () => {
      await result.current.onSubmit();
    });

    // No updateUser call when the net patch is empty.
    expect(updateUserMock).not.toHaveBeenCalled();
  });
});
