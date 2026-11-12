/**
 * @module api/__tests__/integration/socket/chat.memory
 * @description The time context a `message:send` carries: the sender's
 * timezone and a test clock override reach NimbusBot's model request, an
 * unknown timezone falls back to UTC, and the override is ignored in
 * production. The SDK client is mocked at the factory; every broadcast a test
 * triggers (the echo, the bot's reply, the typing signal's end) is awaited
 * before the test ends so nothing publishes after teardown.
 */
import type { Socket as ClientSocket } from "socket.io-client";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const { createAiClient, createMock } = vi.hoisted(() => ({
  createAiClient: vi.fn(),
  createMock: vi.fn(),
}));

vi.mock("../../../lib/ai/clientFactory", () => ({
  createAiClient,
  reasoningKwargs: (handle: { supportsReasoning: boolean }) =>
    handle.supportsReasoning ? { reasoning: { effort: "low" } } : {},
  classifyClientError: () => ({ kind: "provider-error", message: "x" }),
}));

import { createApp } from "../../../app";
import {
  closeTestResources,
  connectClient,
  createWorkspace,
  mintUser,
  resetDatabase,
  startTestServer,
  waitForEvent,
  type TestServer,
  type TestUser,
} from "@testhelpers";
import type { AiClientHandle } from "../../../lib/ai/clientFactory";

const app = createApp();
const openSockets: ClientSocket[] = [];

const waitFor = async (
  done: () => boolean,
  label: string,
  timeoutMs = 10_000,
) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (done()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${label}`);
};

describe("socket: message:send time context", () => {
  let server: TestServer;
  let alice: TestUser;
  let wsId: string;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await closeTestResources();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    for (const socket of openSockets.splice(0)) socket.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    createMock.mockReset();
    createAiClient.mockReset();
    createAiClient.mockImplementation(
      (options): AiClientHandle => ({
        providerId: options.provider.id,
        modelId: options.model.id,
        source: options.source,
        supportsReasoning: options.model.capabilities.includes("reasoning"),
        client: {
          responses: { create: createMock },
        } as unknown as AiClientHandle["client"],
      }),
    );
    createMock.mockResolvedValue({
      output: [{ type: "message" }],
      output_text: "Noted.",
    });

    alice = await mintUser(app);
    wsId = (await createWorkspace(alice.id)).id;
  });

  /** Joins the room and records chat and typing traffic. */
  const join = async () => {
    const socket = connectClient(server.url, { Cookie: alice.cookie });
    await waitForEvent(socket, "connect");
    openSockets.push(socket);
    socket.emit("workspace:join", wsId);
    await waitForEvent(socket, "presence:online_users");
    const messages: Array<{ content: string; userId: string }> = [];
    const typing: boolean[] = [];
    socket.on("message:new", (payload) => messages.push(payload));
    socket.on("bot:typing", (payload: { typing: boolean }) =>
      typing.push(payload.typing),
    );
    return { socket, messages, typing };
  };

  /** Sends a mention and waits for the reply and the end of the typing signal. */
  const mention = async (extra: Record<string, unknown>) => {
    const room = await join();
    room.socket.emit("message:send", {
      workspaceId: wsId,
      content: "@nimbusbot what day is it?",
      ...extra,
    });
    await waitFor(
      () => room.messages.some((m) => m.content === "Noted."),
      "the bot's reply",
    );
    await waitFor(
      () => room.typing.at(-1) === false,
      "the typing signal to end",
    );
    const request = createMock.mock.calls.at(-1)?.[0] as {
      input: Array<{ content: string }>;
    };
    return { room, context: request.input[0]!.content };
  };

  it("hands the sender's timezone and clock override to the model request", async () => {
    const { context } = await mention({
      timeZone: "Asia/Kolkata",
      clockOverride: "2026-11-11T08:35:00Z",
    });
    expect(context).toContain(
      "Today is Wednesday 2026-11-11 (Asia/Kolkata). Time now: 14:05.",
    );
  });

  it("falls back to UTC for a timezone that does not exist, and still delivers the message", async () => {
    const { room, context } = await mention({
      timeZone: "Not/AZone",
      clockOverride: "2026-11-11T08:35:00Z",
    });
    expect(context).toContain("Today is Wednesday 2026-11-11 (UTC).");
    expect(room.messages[0]).toMatchObject({
      content: "@nimbusbot what day is it?",
      userId: alice.id,
    });
  });

  it("uses UTC when no timezone is sent", async () => {
    const { context } = await mention({
      clockOverride: "2026-11-11T08:35:00Z",
    });
    expect(context).toContain("Today is Wednesday 2026-11-11 (UTC).");
  });

  it("accepts the time fields on a message that does not mention the bot", async () => {
    const room = await join();
    room.socket.emit("message:send", {
      workspaceId: wsId,
      content: "just chatting",
      timeZone: "Europe/Paris",
      clockOverride: "2026-11-11",
    });
    await waitFor(
      () => room.messages.some((m) => m.content === "just chatting"),
      "the echo",
    );
    expect(createMock).not.toHaveBeenCalled();
  });

  it("ignores the clock override in production", async () => {
    const room = await join();
    vi.stubEnv("NODE_ENV", "production");
    room.socket.emit("message:send", {
      workspaceId: wsId,
      content: "@nimbusbot what day is it?",
      timeZone: "UTC",
      clockOverride: "2020-02-02T10:00:00Z",
    });
    await waitFor(
      () => room.messages.some((m) => m.content === "Noted."),
      "the bot's reply",
    );
    await waitFor(
      () => room.typing.at(-1) === false,
      "the typing signal to end",
    );

    const request = createMock.mock.calls.at(-1)?.[0] as {
      input: Array<{ content: string }>;
    };
    const context = request.input[0]!.content;
    expect(context).not.toContain("2020-02-02");
    expect(context).toContain(`${new Date().getUTCFullYear()}-`);
  });
});
