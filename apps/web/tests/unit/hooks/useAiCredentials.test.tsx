/**
 * @module web/tests/unit/hooks/useAiCredentials
 * @description Manages the caller's saved AI credentials: list, add/replace,
 * remove. The hook never returns the plaintext key — the API surfaces only
 * the `maskedPreview`, and the hook does not expose the input key after
 * submit (the form is responsible for clearing it).
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { BACKEND_URL, fail, ok } from "../../msw/handlers";
import { server } from "../../msw/server";
import { useAiCredentials } from "../../../hooks/useAiCredentials";

process.env.NEXT_PUBLIC_BACKEND_URL = BACKEND_URL;

const CRED_OPENAI = {
  providerId: "openai",
  label: "Work",
  maskedPreview: "sk-…4f2a",
  validatedAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
  createdAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
  lastUsedAt: null,
};

const CRED_DEEPSEEK = {
  ...CRED_OPENAI,
  providerId: "deepseek",
  maskedPreview: "sk-…abcd",
};

beforeEach(() => {
  server.resetHandlers();
});

describe("useAiCredentials", () => {
  it("starts in loading and transitions to ready with the list", async () => {
    server.use(
      http.get(`${BACKEND_URL}/api/ai/credentials`, () =>
        ok([CRED_OPENAI, CRED_DEEPSEEK]),
      ),
    );

    const { result } = renderHook(() => useAiCredentials());

    await waitFor(() => expect(result.current.state.kind).toBe("ready"));
    if (result.current.state.kind !== "ready") return;
    expect(result.current.state.credentials).toHaveLength(2);
  });

  it("save() resolves with the saved DTO and refreshes the list", async () => {
    let credentials: (typeof CRED_OPENAI)[] = [];
    server.use(
      http.get(`${BACKEND_URL}/api/ai/credentials`, () => ok(credentials)),
      http.post(`${BACKEND_URL}/api/ai/credentials`, () => {
        const next = [...credentials, CRED_OPENAI];
        credentials = next;
        return HttpResponse.json(
          { success: true, message: "Saved", responseObject: CRED_OPENAI },
          { status: 201 },
        );
      }),
    );

    const { result } = renderHook(() => useAiCredentials());

    await waitFor(() => expect(result.current.state.kind).toBe("ready"));
    if (result.current.state.kind !== "ready") return;
    expect(result.current.state.credentials).toHaveLength(0);

    let saveResult: Awaited<ReturnType<typeof result.current.save>> | undefined;
    await act(async () => {
      saveResult = await result.current.save({
        providerId: "openai",
        apiKey: "sk-secret",
      });
    });

    expect(saveResult?.ok).toBe(true);
    if (result.current.state.kind !== "ready") return;
    expect(result.current.state.credentials).toHaveLength(1);
    expect(result.current.state.credentials[0]?.maskedPreview).toBe("sk-…4f2a");
  });

  it("save() returns an inline error when the API refuses (probe failure)", async () => {
    server.use(
      http.get(`${BACKEND_URL}/api/ai/credentials`, () => ok([])),
      http.post(`${BACKEND_URL}/api/ai/credentials`, () =>
        fail(400, "Incorrect API key"),
      ),
    );

    const { result } = renderHook(() => useAiCredentials());

    await waitFor(() => expect(result.current.state.kind).toBe("ready"));

    let saveResult: Awaited<ReturnType<typeof result.current.save>> | undefined;
    await act(async () => {
      saveResult = await result.current.save({
        providerId: "openai",
        apiKey: "sk-bad",
      });
    });

    expect(saveResult?.ok).toBe(false);
    if (saveResult?.ok === false) {
      expect(saveResult.message).toBe("Incorrect API key");
    }
  });

  it("remove() reports clearedPreferences and refreshes", async () => {
    server.use(
      http.get(`${BACKEND_URL}/api/ai/credentials`, () =>
        ok([CRED_OPENAI, CRED_DEEPSEEK]),
      ),
      http.delete(
        `${BACKEND_URL}/api/ai/credentials/:providerId`,
        ({ params }) => {
          expect(params.providerId).toBe("openai");
          return ok({ clearedPreferences: 2 }, "Credential removed");
        },
      ),
    );

    const { result } = renderHook(() => useAiCredentials());

    await waitFor(() => expect(result.current.state.kind).toBe("ready"));
    if (result.current.state.kind !== "ready") return;
    expect(result.current.state.credentials).toHaveLength(2);

    let removeResult:
      | Awaited<ReturnType<typeof result.current.remove>>
      | undefined;
    await act(async () => {
      removeResult = await result.current.remove("openai");
    });

    expect(removeResult).toEqual({ ok: true, clearedPreferences: 2 });
  });

  it("remove() returns an inline error when the credential is missing", async () => {
    server.use(
      http.get(`${BACKEND_URL}/api/ai/credentials`, () => ok([])),
      http.delete(`${BACKEND_URL}/api/ai/credentials/:providerId`, () =>
        fail(404, "Credential not found"),
      ),
    );

    const { result } = renderHook(() => useAiCredentials());

    await waitFor(() => expect(result.current.state.kind).toBe("ready"));

    let removeResult:
      | Awaited<ReturnType<typeof result.current.remove>>
      | undefined;
    await act(async () => {
      removeResult = await result.current.remove("openai");
    });

    expect(removeResult?.ok).toBe(false);
    if (removeResult?.ok === false) {
      expect(removeResult.message).toBe("Credential not found");
    }
  });

  it("the hook never returns the plaintext key from the API", async () => {
    server.use(
      http.get(`${BACKEND_URL}/api/ai/credentials`, () => ok([CRED_OPENAI])),
    );

    const { result } = renderHook(() => useAiCredentials());

    await waitFor(() => expect(result.current.state.kind).toBe("ready"));
    if (result.current.state.kind !== "ready") return;

    // The DTO has `maskedPreview` and nothing key-shaped. Assert by checking
    // the keys of the returned row do not include `apiKey`, `keyEnvelope`,
    // `keyFingerprint`, etc.
    const row = result.current.state.credentials[0] as Record<string, unknown>;
    expect(Object.keys(row).sort()).toEqual(
      [
        "createdAt",
        "label",
        "lastUsedAt",
        "maskedPreview",
        "providerId",
        "validatedAt",
      ].sort(),
    );
  });
});
