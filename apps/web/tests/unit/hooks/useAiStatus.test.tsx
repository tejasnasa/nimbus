/**
 * @module web/tests/unit/hooks/useAiStatus
 * @description Reads `/api/ai/status` and exposes a discriminated
 * `loading | ready | error` state.
 *
 * `refresh()` re-fetches and resolves with the same discriminated shape,
 * so the AI settings panel can re-read after a credential add/remove
 * without forcing the rest of the app to redraw.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { BACKEND_URL, ok } from "../../msw/handlers";
import { server } from "../../msw/server";
import { useAiStatus } from "../../../hooks/useAiStatus";

process.env.NEXT_PUBLIC_BACKEND_URL = BACKEND_URL;

const STATUS = {
  chat: { enabled: true, providerId: null, modelId: null, substituted: false },
  documents: {
    markdown: {
      enabled: true,
      providerId: null,
      modelId: null,
      substituted: false,
    },
    canvas: {
      enabled: true,
      providerId: null,
      modelId: null,
      substituted: false,
    },
    freeRemaining: 4,
    freeLimit: 5,
    freeTierState: "available" as const,
  },
  credentials: [],
  preferences: { chat: null, markdown: null, canvas: null },
};

beforeEach(() => {
  server.resetHandlers();
});

describe("useAiStatus", () => {
  it("starts in loading and transitions to ready with the status payload", async () => {
    server.use(http.get(`${BACKEND_URL}/api/ai/status`, () => ok(STATUS)));

    const { result } = renderHook(() => useAiStatus());

    await waitFor(() => expect(result.current.state.kind).toBe("ready"));
    if (result.current.state.kind !== "ready") return;

    expect(result.current.state.status.documents.freeRemaining).toBe(4);
    expect(result.current.state.status.documents.freeTierState).toBe(
      "available",
    );
    expect(result.current.state.status.chat.enabled).toBe(true);
  });

  it("exposes an error state when the API responds with success=false", async () => {
    server.use(
      http.get(`${BACKEND_URL}/api/ai/status`, () =>
        HttpResponse.json(
          { success: false, message: "AI is offline", responseObject: null },
          { status: 503 },
        ),
      ),
    );

    const { result } = renderHook(() => useAiStatus());

    await waitFor(() => expect(result.current.state.kind).toBe("error"));
    if (result.current.state.kind !== "error") return;
    expect(result.current.state.message).toBe("AI is offline");
  });

  it("falls back to a generic error message when the body is missing one", async () => {
    server.use(
      http.get(`${BACKEND_URL}/api/ai/status`, () =>
        HttpResponse.json({ success: false }, { status: 500 }),
      ),
    );

    const { result } = renderHook(() => useAiStatus());

    await waitFor(() => expect(result.current.state.kind).toBe("error"));
    if (result.current.state.kind !== "error") return;
    expect(result.current.state.message).toBe(
      "Could not load AI status. Please try again.",
    );
  });

  it("refresh() re-fetches and replaces the status payload", async () => {
    let counter = 0;
    server.use(
      http.get(`${BACKEND_URL}/api/ai/status`, () => {
        counter += 1;
        return ok({
          ...STATUS,
          documents: {
            ...STATUS.documents,
            freeRemaining: counter === 1 ? 4 : 2,
          },
        });
      }),
    );

    const { result } = renderHook(() => useAiStatus());

    await waitFor(() => expect(result.current.state.kind).toBe("ready"));
    if (result.current.state.kind !== "ready") return;
    expect(result.current.state.status.documents.freeRemaining).toBe(4);

    await act(async () => {
      await result.current.refresh();
    });

    if (result.current.state.kind !== "ready") return;
    expect(result.current.state.status.documents.freeRemaining).toBe(2);
    // Two network calls: the auto-fetch on mount + the explicit refresh.
    expect(counter).toBe(2);
  });
});
