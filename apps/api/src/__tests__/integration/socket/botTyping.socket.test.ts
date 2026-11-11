/**
 * @module api/__tests__/integration/socket/botTyping
 * @description `bot:typing` over a real socket server: on when NimbusBot starts
 * answering a mention, off when the reply lands, a refusal or failure ends it,
 * the hand-over to document generation ends it before the overlay events, and
 * overlapping mentions are counted.
 *
 * The model client is stubbed at the factory, as in the bot suite. Every test
 * waits for the last broadcast its flow makes before it ends, so the server
 * is never torn down with a Redis publish still in flight.
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
import { env } from "../../../lib/env";
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

const reply = (text: string) => ({
  output: [{ type: "message" }],
  output_text: text,
});

/** What a socket saw, in order, of the events these tests care about. */
const record = (socket: ClientSocket) => {
  const seen: string[] = [];
  socket.on("bot:typing", (data: { workspaceId: string; typing: boolean }) =>
    seen.push(data.typing ? "typing:on" : "typing:off"),
  );
  socket.on("message:new", (data: { userId: string }) =>
    seen.push(data.userId === env.BOT_USERID ? "message:bot" : "message:user"),
  );
  socket.on("doc:ai:start", () => seen.push("doc:start"));
  socket.on("doc:ai:complete", () => seen.push("doc:complete"));
  socket.on("doc:ai:error", () => seen.push("doc:error"));
  socket.on("ai:refused", () => seen.push("refused"));
  return seen;
};

/** Polls until `done()` holds, or throws after the timeout. */
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

const settle = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));

describe("socket: bot:typing", () => {
  let server: TestServer;
  let alice: TestUser;
  let wsId: string;

  const join = async () => {
    const socket = connectClient(server.url, { Cookie: alice.cookie });
    await waitForEvent(socket, "connect");
    openSockets.push(socket);
    socket.emit("workspace:join", wsId);
    await waitForEvent(socket, "presence:online_users");
    return socket;
  };

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await closeTestResources();
  });

  afterEach(() => {
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

    alice = await mintUser(app);
    wsId = (await createWorkspace(alice.id)).id;
  });

  it("is on while the reply is being written and off once it is posted", async () => {
    createMock.mockResolvedValue(reply("Hello!"));
    const socket = await join();
    const seen = record(socket);

    socket.emit("message:send", {
      workspaceId: wsId,
      content: "@nimbusbot hi",
    });
    await waitFor(() => seen.includes("typing:off"), "typing to end");

    expect(seen).toEqual([
      "message:user",
      "typing:on",
      "message:bot",
      "typing:off",
    ]);
  });

  it("names the workspace in the payload", async () => {
    createMock.mockResolvedValue(reply("Hello!"));
    const socket = await join();
    const on = waitForEvent<{ workspaceId: string; typing: boolean }>(
      socket,
      "bot:typing",
    );

    socket.emit("message:send", {
      workspaceId: wsId,
      content: "@nimbusbot hi",
    });

    await expect(on).resolves.toEqual({ workspaceId: wsId, typing: true });
    await waitFor(
      () => createMock.mock.calls.length > 0,
      "the model to be called",
    );
    await settle(); // the reply and `typing: false` follow
  });

  it("does not show a message that does not mention the bot", async () => {
    const socket = await join();
    const seen = record(socket);

    socket.emit("message:send", {
      workspaceId: wsId,
      content: "just chatting",
    });
    await waitFor(() => seen.includes("message:user"), "the echo");
    await settle();

    expect(seen).toEqual(["message:user"]);
  });

  it("ends before the document overlay starts when the bot hands over to generation", async () => {
    createMock.mockImplementation(
      async (args: { tools?: unknown; stream?: boolean }) => {
        if (args.tools) {
          return {
            output: [
              {
                type: "function_call",
                name: "create_document",
                arguments: JSON.stringify({
                  type: "MARKDOWN",
                  label: "Typing Doc",
                  prompt: "p",
                }),
              },
            ],
            output_text: "",
          };
        }
        return (async function* stream() {
          yield { type: "response.output_text.delta", delta: "# Body" };
        })();
      },
    );
    const socket = await join();
    const seen = record(socket);

    socket.emit("message:send", {
      workspaceId: wsId,
      content: "@nimbusbot write a doc",
    });
    await waitFor(() => seen.includes("doc:complete"), "the document");

    expect(seen).toEqual([
      "message:user",
      "typing:on",
      "message:bot",
      "typing:off",
      "doc:start",
      "doc:complete",
    ]);
  });

  it("ends when the model call fails and the bot degrades to its fallback reply", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    createMock.mockRejectedValue(new Error("provider down"));
    const socket = await join();
    const seen = record(socket);

    socket.emit("message:send", {
      workspaceId: wsId,
      content: "@nimbusbot hi",
    });
    await waitFor(() => seen.includes("typing:off"), "typing to end");

    expect(seen).toEqual([
      "message:user",
      "typing:on",
      "message:bot",
      "typing:off",
    ]);
    errorSpy.mockRestore();
  });

  it("never turns on for a mention the resolver refuses", async () => {
    // An empty key disables the free tier, which leaves this user no model.
    vi.stubEnv("AI_API_KEY", "");
    try {
      const socket = await join();
      const seen = record(socket);

      socket.emit("message:send", {
        workspaceId: wsId,
        content: "@nimbusbot hi",
      });
      await waitFor(() => seen.includes("refused"), "the refusal");
      await settle();

      expect(seen).toEqual(["message:user", "refused"]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("counts overlapping mentions and turns off only after the last one", async () => {
    const releases: Array<() => void> = [];
    createMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          releases.push(() => resolve(reply("answer")));
        }),
    );
    const socket = await join();
    const seen = record(socket);

    socket.emit("message:send", {
      workspaceId: wsId,
      content: "@nimbusbot one",
    });
    socket.emit("message:send", {
      workspaceId: wsId,
      content: "@nimbusbot two",
    });
    await waitFor(() => releases.length === 2, "both model calls");

    releases[0]!();
    await waitFor(() => seen.includes("message:bot"), "the first reply");
    await settle();
    // One mention is still being answered, so the indicator stays on.
    expect(seen.filter((e) => e === "typing:off")).toHaveLength(0);

    releases[1]!();
    await waitFor(() => seen.includes("typing:off"), "typing to end");

    expect(seen.filter((e) => e === "typing:on")).toHaveLength(1);
    expect(seen.filter((e) => e === "typing:off")).toHaveLength(1);
    expect(seen.filter((e) => e === "message:bot")).toHaveLength(2);
    expect(seen.at(-1)).toBe("typing:off");
  });
});
