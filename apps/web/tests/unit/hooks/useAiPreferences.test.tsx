/**
 * @module web/tests/unit/hooks/useAiPreferences
 * @description Per-feature provider/model preferences. Saving a preference
 * marks only that feature as pending so the picker can keep the other
 * features interactive.
 *
 * Failures are surfaced inline (no `alert()`).
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { BACKEND_URL, fail, ok } from "../../msw/handlers";
import { server } from "../../msw/server";
import { useAiPreferences } from "../../../hooks/useAiPreferences";

process.env.NEXT_PUBLIC_BACKEND_URL = BACKEND_URL;

const PREF = {
  feature: "chat" as const,
  providerId: "openai",
  modelId: "gpt-5-nano",
};

beforeEach(() => {
  server.resetHandlers();
});

describe("useAiPreferences", () => {
  it("starts in loading and transitions to ready with the preferences map", async () => {
    server.use(
      http.get(`${BACKEND_URL}/api/ai/preferences`, () =>
        ok({ chat: PREF, markdown: null, canvas: null }),
      ),
    );

    const { result } = renderHook(() => useAiPreferences());

    await waitFor(() => expect(result.current.state.kind).toBe("ready"));
    if (result.current.state.kind !== "ready") return;
    expect(result.current.state.preferences.chat).toEqual(PREF);
    expect(result.current.pending).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("save() updates only the targeted feature", async () => {
    // Typed explicitly — the literal starts with `markdown: null`, so without
    // the annotation TS would infer `markdown` as `null` and reject the later
    // assignment to an object. `feature` is widened to the full union so each
    // slot can hold a different feature value.
    let saved: {
      chat: {
        feature: "chat" | "markdown" | "canvas";
        providerId: string;
        modelId: string;
      } | null;
      markdown: {
        feature: "chat" | "markdown" | "canvas";
        providerId: string;
        modelId: string;
      } | null;
      canvas: {
        feature: "chat" | "markdown" | "canvas";
        providerId: string;
        modelId: string;
      } | null;
    } = { chat: PREF, markdown: null, canvas: null };
    server.use(
      http.get(`${BACKEND_URL}/api/ai/preferences`, () => ok(saved)),
      http.put(`${BACKEND_URL}/api/ai/preferences`, async ({ request }) => {
        const body = (await request.json()) as typeof PREF;
        saved = {
          ...saved,
          markdown: {
            feature: "markdown",
            providerId: body.providerId,
            modelId: body.modelId,
          },
        };
        return ok(saved.markdown, "Saved");
      }),
    );

    const { result } = renderHook(() => useAiPreferences());

    await waitFor(() => expect(result.current.state.kind).toBe("ready"));

    await act(async () => {
      await result.current.save({
        feature: "markdown",
        providerId: "deepseek",
        modelId: "deepseek-flash",
      });
    });

    if (result.current.state.kind !== "ready") return;
    expect(result.current.state.preferences.markdown).toMatchObject({
      feature: "markdown",
      providerId: "deepseek",
      modelId: "deepseek-flash",
    });
    // Chat is unchanged.
    expect(result.current.state.preferences.chat).toEqual(PREF);
  });

  it("save() reports pending during the call and clears it after", async () => {
    let release: (() => void) | undefined;
    server.use(
      http.get(`${BACKEND_URL}/api/ai/preferences`, () =>
        ok({ chat: null, markdown: null, canvas: null }),
      ),
      http.put(
        `${BACKEND_URL}/api/ai/preferences`,
        () =>
          new Promise<ReturnType<typeof HttpResponse.json>>((resolve) => {
            release = () =>
              resolve(
                HttpResponse.json({
                  success: true,
                  message: "Saved",
                  responseObject: PREF,
                }),
              );
          }),
      ),
    );

    const { result } = renderHook(() => useAiPreferences());

    await waitFor(() => expect(result.current.state.kind).toBe("ready"));

    let inFlight!: Promise<unknown>;
    await act(async () => {
      inFlight = result.current.save(PREF);
      // Yield once so the synchronous `setPending` triggers a render and
      // the test can observe the in-flight state.
      await new Promise((r) => setTimeout(r, 0));
    });
    // While the request is in flight, that feature is pending.
    expect(result.current.pending).toBe("chat");

    await act(async () => {
      release?.();
      await inFlight;
    });
    expect(result.current.pending).toBeNull();
  });

  it("save() surfaces the API's error message inline", async () => {
    server.use(
      http.get(`${BACKEND_URL}/api/ai/preferences`, () =>
        ok({ chat: null, markdown: null, canvas: null }),
      ),
      http.put(`${BACKEND_URL}/api/ai/preferences`, () =>
        fail(422, "Model does not support JSON mode"),
      ),
    );

    const { result } = renderHook(() => useAiPreferences());

    await waitFor(() => expect(result.current.state.kind).toBe("ready"));

    let saveResult: Awaited<ReturnType<typeof result.current.save>> | undefined;
    await act(async () => {
      saveResult = await result.current.save(PREF);
    });

    expect(saveResult?.ok).toBe(false);
    expect(result.current.error).toBe("Model does not support JSON mode");
  });

  it("a previous error clears when a later save succeeds", async () => {
    let shouldFail = true;
    server.use(
      http.get(`${BACKEND_URL}/api/ai/preferences`, () =>
        ok({ chat: null, markdown: null, canvas: null }),
      ),
      http.put(`${BACKEND_URL}/api/ai/preferences`, () => {
        if (shouldFail) return fail(422, "first rejection");
        return ok(PREF, "Saved");
      }),
    );

    const { result } = renderHook(() => useAiPreferences());

    await waitFor(() => expect(result.current.state.kind).toBe("ready"));

    await act(async () => {
      await result.current.save(PREF);
    });
    expect(result.current.error).toBe("first rejection");

    shouldFail = false;
    await act(async () => {
      await result.current.save(PREF);
    });
    expect(result.current.error).toBeNull();
  });
});
