/**
 * @module web/tests/unit/hooks/useAddApiKeyForm
 * @description RHF + Zod wrapper around the API-key dialog form.
 *
 * The hook is decoupled from `useAiCredentials.save`; the dialog hands it
 * the save function. The hook's responsibility:
 *  - Zod validation (`aiCredentialCreateSchema`)
 *  - Clearing the key from state on success
 *  - Surfacing server errors inline (no `alert()`)
 *  - Exposing `reset()` so the dialog can clear the key on close
 */
import type { ChangeEvent } from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  useAddApiKeyForm,
  type SubmitResult,
} from "../../../hooks/useAddApiKeyForm";

/** Builds a synthetic React change event for a given field name. */
const change = (name: string, value: string) =>
  ({ target: { name, value } }) as unknown as ChangeEvent<HTMLInputElement>;

/** Fills the three fields the schema requires. */
const fillValid = (
  register: ReturnType<typeof useAddApiKeyForm>["register"],
) => {
  register("providerId").onChange(change("providerId", "openai"));
  register("apiKey").onChange(change("apiKey", "sk-valid-key-1234"));
  register("label").onChange(change("label", "My key"));
};

describe("useAddApiKeyForm", () => {
  it("starts with empty defaults and no errors", () => {
    const { result } = renderHook(() => useAddApiKeyForm());
    expect(result.current.firstError).toBeUndefined();
    expect(result.current.isSubmitting).toBe(false);
  });

  it("blocks submit with an inline Zod error when the key is empty", async () => {
    const save = vi.fn();
    const { result } = renderHook(() => useAddApiKeyForm());

    await act(async () => {
      await result.current.onSubmit(save);
    });

    expect(save).not.toHaveBeenCalled();
    // RHF surfaces the first schema-level message.
    expect(result.current.firstError).toBeTruthy();
  });

  it("calls the save function and clears the key on success", async () => {
    const save = vi.fn().mockResolvedValue({ ok: true as const });
    const { result } = renderHook(() => useAddApiKeyForm());

    act(() => {
      fillValid(result.current.register);
    });

    await act(async () => {
      await result.current.onSubmit(save);
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({
      providerId: "openai",
      apiKey: "sk-valid-key-1234",
      label: "My key",
    });
    // After success, the key has been cleared. A subsequent submit must
    // therefore fail validation, not call `save` a second time.
    await act(async () => {
      await result.current.onSubmit(save);
    });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("keeps the key and surfaces the server error inline on failure", async () => {
    const save = vi
      .fn()
      .mockResolvedValue({ ok: false as const, message: "Incorrect API key" });
    const { result } = renderHook(() => useAddApiKeyForm());

    act(() => {
      fillValid(result.current.register);
    });

    await act(async () => {
      await result.current.onSubmit(save);
    });

    expect(result.current.firstError).toBe("Incorrect API key");
    // A second submit still calls `save` — the key was not cleared.
    await act(async () => {
      await result.current.onSubmit(save);
    });
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("isSubmitting is true while the save promise is in flight", async () => {
    let resolveSave!: () => void;
    const save = vi.fn(
      () =>
        new Promise<{ ok: true }>((res) => {
          resolveSave = () => res({ ok: true });
        }),
    );
    const { result } = renderHook(() => useAddApiKeyForm());

    act(() => {
      fillValid(result.current.register);
    });

    // Kick off submit inside `act` so the synchronous setPending/state
    // updates batch and the test can observe `isSubmitting: true` before
    // resolving the save. `onSubmit` resolves to a `SubmitResult`
    // (`{ ok: true } | { ok: false; message }`), so the in-flight variable
    // is typed accordingly — not as `Promise<{ ok: true }>`.
    let inFlight!: Promise<SubmitResult>;
    await act(async () => {
      inFlight = result.current.onSubmit(save);
      // Yield once so React commits the `isSubmitting: true` state.
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(result.current.isSubmitting).toBe(true);

    await act(async () => {
      resolveSave();
      await inFlight;
    });
    expect(result.current.isSubmitting).toBe(false);
  });

  it("reset() clears the key from state", async () => {
    const { result } = renderHook(() => useAddApiKeyForm());

    act(() => {
      fillValid(result.current.register);
    });

    act(() => {
      result.current.reset();
    });

    // After reset, a submit must fail validation because the apiKey field is
    // empty — the form is back to its seeded defaults.
    const save = vi.fn();
    await act(async () => {
      await result.current.onSubmit(save);
    });
    expect(save).not.toHaveBeenCalled();
    expect(result.current.firstError).toBeTruthy();
  });
});
