/**
 * @module web/tests/unit/hooks/useWorkspaceAi
 * @description The workspace AI hooks and the fetch wrapper under them:
 * status, credentials, preferences, settings, the paged usage log and the
 * caller's free allowance. Each is driven against MSW with the real envelope,
 * so a client that ignored `success: false` would fail here.
 */
import "../../components/testUtils";
import { act, renderHook, waitFor } from "@testing-library/react";
import { http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { aiApi, workspaceAiPath } from "../../../lib/aiApi";
import { useAiFreeUsage } from "../../../hooks/useAiFreeUsage";
import { useWorkspaceAiCredentials } from "../../../hooks/useWorkspaceAiCredentials";
import { useWorkspaceAiPreferences } from "../../../hooks/useWorkspaceAiPreferences";
import { useWorkspaceAiSettings } from "../../../hooks/useWorkspaceAiSettings";
import { useWorkspaceAiStatus } from "../../../hooks/useWorkspaceAiStatus";
import { useWorkspaceAiUsage } from "../../../hooks/useWorkspaceAiUsage";
import { BACKEND_URL, fail, ok } from "../../msw/handlers";
import { server } from "../../msw/server";
import {
  aiSettings,
  aiStatus,
  callRow,
  credential,
  freeUsage,
  usagePage,
} from "../../msw/aiFixtures";

const WS = "ws-1";
const route = (suffix: string) => `${BACKEND_URL}/api/ai/workspaces/${WS}${suffix}`;

beforeEach(() => {
  server.resetHandlers();
});

describe("aiApi", () => {
  it("builds workspace paths, encoding the id", () => {
    expect(workspaceAiPath("a b", "/status")).toBe("/api/ai/workspaces/a%20b/status");
    expect(workspaceAiPath("ws")).toBe("/api/ai/workspaces/ws");
  });

  it("unwraps a successful envelope", async () => {
    server.use(http.get(route("/status"), () => ok({ hello: "world" }, "fine")));
    const result = await aiApi<{ hello: string }>(workspaceAiPath(WS, "/status"));
    expect(result).toEqual({ ok: true, data: { hello: "world" }, message: "fine" });
  });

  it("turns a failure envelope into a message and the status", async () => {
    server.use(http.get(route("/status"), () => fail(403, "No way")));
    const result = await aiApi(workspaceAiPath(WS, "/status"));
    expect(result).toEqual({ ok: false, message: "No way", status: 403 });
  });

  it("uses the fallback when the server gave no message", async () => {
    server.use(http.get(route("/status"), () => fail(500, "")));
    const result = await aiApi(workspaceAiPath(WS, "/status"), {}, "Fallback text");
    expect(result).toMatchObject({ ok: false, message: "Fallback text" });
  });

  it("returns a failure instead of throwing on a network error", async () => {
    server.use(http.get(route("/status"), () => Response.error()));
    const result = await aiApi(workspaceAiPath(WS, "/status"), {}, "Fallback text");
    expect(result.ok).toBe(false);
  });

  it("sends the body as JSON with the session cookie", async () => {
    let seen: { body: unknown; credentials: string } | null = null;
    server.use(
      http.put(route("/settings"), async ({ request }) => {
        seen = { body: await request.json(), credentials: request.credentials };
        return ok(aiSettings());
      }),
    );
    await aiApi(workspaceAiPath(WS, "/settings"), {
      method: "PUT",
      body: { assistantEnabled: false },
    });
    expect(seen).toMatchObject({
      body: { assistantEnabled: false },
      credentials: "include",
    });
  });
});

describe("useWorkspaceAiStatus", () => {
  it("loads the status, then refreshes it", async () => {
    let call = 0;
    server.use(
      http.get(route("/status"), () => {
        call += 1;
        return ok(aiStatus({ canManage: call > 1 }));
      }),
    );
    const { result } = renderHook(() => useWorkspaceAiStatus(WS));
    expect(result.current.state.kind).toBe("loading");
    await waitFor(() => expect(result.current.state.kind).toBe("ready"));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.state).toMatchObject({
      kind: "ready",
      status: { canManage: true },
    });
  });

  it("reports an error state with the server's message", async () => {
    server.use(http.get(route("/status"), () => fail(404, "Workspace not found")));
    const { result } = renderHook(() => useWorkspaceAiStatus(WS));
    await waitFor(() =>
      expect(result.current.state).toEqual({
        kind: "error",
        message: "Workspace not found",
      }),
    );
  });
});

describe("useWorkspaceAiCredentials", () => {
  it("lists credentials when enabled", async () => {
    server.use(http.get(route("/credentials"), () => ok([credential()])));
    const { result } = renderHook(() => useWorkspaceAiCredentials(WS, true));
    await waitFor(() => expect(result.current.state.kind).toBe("ready"));
    expect(result.current.state).toMatchObject({
      credentials: [{ providerId: "openai" }],
    });
  });

  it("never calls the admin-only route for a member", async () => {
    let hits = 0;
    server.use(
      http.get(route("/credentials"), () => {
        hits += 1;
        return ok([]);
      }),
    );
    const { result } = renderHook(() => useWorkspaceAiCredentials(WS, false));
    await new Promise((r) => setTimeout(r, 30));
    expect(hits).toBe(0);
    expect(result.current.state).toEqual({ kind: "ready", credentials: [] });
  });

  it("saves, returns the warnings and refreshes the list", async () => {
    let stored = false;
    server.use(
      http.get(route("/credentials"), () => ok(stored ? [credential()] : [])),
      http.post(route("/credentials"), async ({ request }) => {
        expect(await request.json()).toEqual({ providerId: "openai", apiKey: "sk-x" });
        stored = true;
        return ok({ ...credential(), warnings: ["Speech models could not be verified: x"] });
      }),
    );
    const { result } = renderHook(() => useWorkspaceAiCredentials(WS, true));
    await waitFor(() => expect(result.current.state.kind).toBe("ready"));

    let outcome: Awaited<ReturnType<typeof result.current.save>> | undefined;
    await act(async () => {
      outcome = await result.current.save({ providerId: "openai", apiKey: "sk-x" });
    });
    expect(outcome).toMatchObject({
      ok: true,
      warnings: ["Speech models could not be verified: x"],
    });
    expect(result.current.state).toMatchObject({ credentials: [{ providerId: "openai" }] });
  });

  it("returns the server's message when a save is refused", async () => {
    server.use(
      http.get(route("/credentials"), () => ok([])),
      http.post(route("/credentials"), () => fail(400, "Incorrect API key.")),
    );
    const { result } = renderHook(() => useWorkspaceAiCredentials(WS, true));
    await waitFor(() => expect(result.current.state.kind).toBe("ready"));
    let outcome: Awaited<ReturnType<typeof result.current.save>> | undefined;
    await act(async () => {
      outcome = await result.current.save({ providerId: "openai", apiKey: "sk-x" });
    });
    expect(outcome).toEqual({ ok: false, message: "Incorrect API key." });
  });

  it("removes a credential and reports the preferences it cleared", async () => {
    server.use(
      http.get(route("/credentials"), () => ok([])),
      http.delete(route("/credentials/openai"), () =>
        ok({ clearedPreferences: 2 }, "Credential removed"),
      ),
    );
    const { result } = renderHook(() => useWorkspaceAiCredentials(WS, true));
    await waitFor(() => expect(result.current.state.kind).toBe("ready"));
    let outcome: Awaited<ReturnType<typeof result.current.remove>> | undefined;
    await act(async () => {
      outcome = await result.current.remove("openai");
    });
    expect(outcome).toEqual({ ok: true, clearedPreferences: 2 });
  });

  it("surfaces a list failure as an error state", async () => {
    server.use(http.get(route("/credentials"), () => fail(403, "Forbidden")));
    const { result } = renderHook(() => useWorkspaceAiCredentials(WS, true));
    await waitFor(() =>
      expect(result.current.state).toEqual({ kind: "error", message: "Forbidden" }),
    );
  });
});

describe("useWorkspaceAiPreferences", () => {
  it("loads preferences merged over an empty map", async () => {
    server.use(
      http.get(route("/preferences"), () =>
        ok({ chat: { feature: "chat", providerId: "openai", modelId: "gpt-5-nano" } }),
      ),
    );
    const { result } = renderHook(() => useWorkspaceAiPreferences(WS));
    await waitFor(() => expect(result.current.state.kind).toBe("ready"));
    if (result.current.state.kind !== "ready") return;
    expect(result.current.state.preferences.chat?.modelId).toBe("gpt-5-nano");
    expect(result.current.state.preferences.speech).toBeNull();
  });

  it("saves with the wire field names and never sends capabilities", async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.put(route("/preferences"), async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return ok({ feature: "speech", providerId: "openai", modelId: "gpt-4o-mini-tts" });
      }),
    );
    const { result } = renderHook(() => useWorkspaceAiPreferences(WS));
    await waitFor(() => expect(result.current.state.kind).toBe("ready"));
    await act(async () => {
      await result.current.save({
        feature: "speech",
        providerId: "openai",
        modelId: "gpt-4o-mini-tts",
        modelSource: "registry",
        modelCapabilities: ["tools"],
        voice: "coral",
      });
    });
    expect(body).toEqual({
      feature: "speech",
      providerId: "openai",
      modelId: "gpt-4o-mini-tts",
      source: "registry",
      voice: "coral",
    });
    expect(result.current.pending).toBeNull();
  });

  it("keeps the message and clears pending when a save is refused", async () => {
    server.use(http.put(route("/preferences"), () => fail(422, "No credential saved.")));
    const { result } = renderHook(() => useWorkspaceAiPreferences(WS));
    await waitFor(() => expect(result.current.state.kind).toBe("ready"));
    let outcome: Awaited<ReturnType<typeof result.current.save>> | undefined;
    await act(async () => {
      outcome = await result.current.save({
        feature: "chat",
        providerId: "openai",
        modelId: "gpt-5-nano",
      });
    });
    expect(outcome).toEqual({ ok: false, message: "No credential saved." });
    expect(result.current.error).toBe("No credential saved.");
    expect(result.current.pending).toBeNull();
  });
});

describe("useWorkspaceAiSettings", () => {
  it("loads and saves, keeping the server's returned values", async () => {
    server.use(
      http.get(route("/settings"), () => ok(aiSettings())),
      http.put(route("/settings"), () =>
        ok(aiSettings({ monthlySpendCapUsd: 25, monthToDateCostUsd: 1.5 })),
      ),
    );
    const { result } = renderHook(() => useWorkspaceAiSettings(WS));
    await waitFor(() => expect(result.current.state.kind).toBe("ready"));
    let outcome: Awaited<ReturnType<typeof result.current.save>> | undefined;
    await act(async () => {
      outcome = await result.current.save({ monthlySpendCapUsd: 25 });
    });
    expect(outcome).toEqual({ ok: true });
    expect(result.current.state).toMatchObject({
      settings: { monthlySpendCapUsd: 25, monthToDateCostUsd: 1.5 },
    });
    expect(result.current.saving).toBe(false);
  });

  it("leaves the last good values on a rejected save", async () => {
    server.use(
      http.get(route("/settings"), () => ok(aiSettings({ monthlySpendCapUsd: 10 }))),
      http.put(route("/settings"), () => fail(403, "Forbidden")),
    );
    const { result } = renderHook(() => useWorkspaceAiSettings(WS));
    await waitFor(() => expect(result.current.state.kind).toBe("ready"));
    let outcome: Awaited<ReturnType<typeof result.current.save>> | undefined;
    await act(async () => {
      outcome = await result.current.save({ monthlySpendCapUsd: null });
    });
    expect(outcome).toEqual({ ok: false, message: "Forbidden" });
    expect(result.current.state).toMatchObject({
      settings: { monthlySpendCapUsd: 10 },
    });
  });
});

describe("useWorkspaceAiUsage", () => {
  it("does not fetch when disabled", async () => {
    let hits = 0;
    server.use(
      http.get(route("/usage"), () => {
        hits += 1;
        return ok(usagePage());
      }),
    );
    renderHook(() => useWorkspaceAiUsage(WS, false));
    await new Promise((r) => setTimeout(r, 30));
    expect(hits).toBe(0);
  });

  it("loads the first page, then appends the next on loadMore", async () => {
    const cursors: Array<string | null> = [];
    server.use(
      http.get(route("/usage"), ({ request }) => {
        const cursor = new URL(request.url).searchParams.get("cursor");
        cursors.push(cursor);
        return cursor
          ? ok(usagePage([callRow({ id: "call-2" })], null))
          : ok(usagePage([callRow({ id: "call-1" })], "cursor-1"));
      }),
    );
    const { result } = renderHook(() => useWorkspaceAiUsage(WS, true));
    await waitFor(() => expect(result.current.calls).toHaveLength(1));
    expect(result.current.nextCursor).toBe("cursor-1");
    expect(result.current.totals?.month).toBe("2026-11");

    await act(async () => {
      await result.current.loadMore();
    });
    expect(result.current.calls.map((c) => c.id)).toEqual(["call-1", "call-2"]);
    expect(result.current.nextCursor).toBeNull();
    expect(cursors).toEqual([null, "cursor-1"]);
  });

  it("restarts from the first page when a filter changes", async () => {
    const queries: string[] = [];
    server.use(
      http.get(route("/usage"), ({ request }) => {
        queries.push(new URL(request.url).search);
        return ok(usagePage());
      }),
    );
    const { result } = renderHook(() => useWorkspaceAiUsage(WS, true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
      result.current.setFilters({ feature: "canvas", status: "error" });
    });
    await waitFor(() => expect(queries.length).toBe(2));
    expect(queries[1]).toContain("feature=canvas");
    expect(queries[1]).toContain("status=error");
    expect(queries[1]).not.toContain("cursor=");
  });

  it("keeps the rows already shown when a later page fails", async () => {
    server.use(
      http.get(route("/usage"), ({ request }) =>
        new URL(request.url).searchParams.get("cursor")
          ? fail(500, "Boom")
          : ok(usagePage([callRow()], "cursor-1")),
      ),
    );
    const { result } = renderHook(() => useWorkspaceAiUsage(WS, true));
    await waitFor(() => expect(result.current.calls).toHaveLength(1));
    await act(async () => {
      await result.current.loadMore();
    });
    expect(result.current.calls).toHaveLength(1);
    expect(result.current.error).toBe("Boom");
    expect(result.current.loadingMore).toBe(false);
  });

  it("reports a first-page failure", async () => {
    server.use(http.get(route("/usage"), () => fail(403, "Forbidden")));
    const { result } = renderHook(() => useWorkspaceAiUsage(WS, true));
    await waitFor(() => expect(result.current.error).toBe("Forbidden"));
    expect(result.current.loading).toBe(false);
  });

  it("does nothing on loadMore without a cursor", async () => {
    server.use(http.get(route("/usage"), () => ok(usagePage())));
    const { result } = renderHook(() => useWorkspaceAiUsage(WS, true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.loadMore();
    });
    expect(result.current.calls).toHaveLength(1);
  });
});

describe("useAiFreeUsage", () => {
  it("starts from the server-rendered value and refreshes it", async () => {
    server.use(
      http.get(`${BACKEND_URL}/api/ai/me/free-usage`, () =>
        ok(freeUsage({ docsRemaining: 2 })),
      ),
    );
    const { result } = renderHook(() => useAiFreeUsage(freeUsage({ docsRemaining: 5 })));
    expect(result.current.usage.docsRemaining).toBe(5);
    await waitFor(() => expect(result.current.usage.docsRemaining).toBe(2));
    expect(result.current.error).toBeNull();
  });

  it("keeps the initial value and reports a failed refresh", async () => {
    server.use(
      http.get(`${BACKEND_URL}/api/ai/me/free-usage`, () => fail(500, "Down")),
    );
    const { result } = renderHook(() => useAiFreeUsage(freeUsage()));
    await waitFor(() => expect(result.current.error).toBe("Down"));
    expect(result.current.usage.docsRemaining).toBe(5);
  });
});
