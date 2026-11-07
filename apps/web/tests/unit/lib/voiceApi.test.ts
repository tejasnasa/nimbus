/**
 * @module web/tests/unit/lib/voiceApi
 * @description The call-token request: what it sends, how it unwraps the
 * envelope, and that every failure becomes a returned message rather than a
 * throw.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchVoiceToken } from "../../../lib/voiceApi";

const fetchMock = vi.fn();

const envelope = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as Response;

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  process.env.NEXT_PUBLIC_BACKEND_URL = "http://api.test";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("lib/voiceApi", () => {
  it("posts the workspace id with the session cookie", async () => {
    fetchMock.mockResolvedValue(
      envelope({
        success: true,
        responseObject: { token: "t", url: "wss://x", roomName: "nimbus-ws-w" },
      }),
    );

    await fetchVoiceToken("w");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://api.test/api/voice/token");
    expect(init).toMatchObject({ method: "POST", credentials: "include" });
    expect(JSON.parse(init.body)).toEqual({ workspaceId: "w" });
  });

  it("returns the token, URL and room on success", async () => {
    fetchMock.mockResolvedValue(
      envelope({
        success: true,
        responseObject: { token: "t", url: "wss://x", roomName: "nimbus-ws-w" },
      }),
    );

    await expect(fetchVoiceToken("w")).resolves.toEqual({
      ok: true,
      token: "t",
      url: "wss://x",
      roomName: "nimbus-ws-w",
    });
  });

  it("returns the server's message and status on a refusal", async () => {
    fetchMock.mockResolvedValue(
      envelope({ success: false, message: "Workspace not found" }, 404),
    );

    await expect(fetchVoiceToken("w")).resolves.toEqual({
      ok: false,
      message: "Workspace not found",
      status: 404,
    });
  });

  it("falls back to a generic message when the server gave none", async () => {
    fetchMock.mockResolvedValue(envelope({ success: false }, 500));

    const result = await fetchVoiceToken("w");

    expect(result).toMatchObject({ ok: false, status: 500 });
    expect(result.ok === false && result.message).toMatch(/try again/i);
  });

  it("treats a success envelope without a payload as a failure", async () => {
    fetchMock.mockResolvedValue(envelope({ success: true }));

    await expect(fetchVoiceToken("w")).resolves.toMatchObject({ ok: false });
  });

  it("resolves, never throws, when the network is down", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(fetchVoiceToken("w")).resolves.toEqual({
      ok: false,
      message: expect.stringMatching(/try again/i),
      status: 0,
    });
  });
});
