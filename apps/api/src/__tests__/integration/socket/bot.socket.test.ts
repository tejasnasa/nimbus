/**
 * @module api/__tests__/integration/socket/bot
 * @description The `@nimbusbot` mention pipeline end to end: a mention is
 * answered in chat, and a `create_document` decision produces a real Document
 * row plus the `doc:ai:*` streaming events the client renders.
 *
 * The SDK client is mocked at the boundary: `lib/ai/clientFactory.createAiClient`
 * returns a fake handle whose `responses.create` is the mocked `createMock`,
 * dispatching on the request shape — the bot decision carries `tools`, the
 * markdown generator asks for a stream.
 *
 * @important The CANVAS generation path over sockets is not covered here: its
 *            stream event shape is exercised at the unit level instead
 *            (`canvasGeneration.test.ts`). What is covered is its *failure*
 *            branch, which is shared. The happy path would be worth adding.
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
  testPrisma,
  waitForEvent,
  type TestServer,
  type TestUser,
} from "@testhelpers";
import type { AiClientHandle } from "../../../lib/ai/clientFactory";
import { buildAad, encryptSecret } from "../../../lib/ai/credentialCrypto";

/** Stub SDK client type — only `responses.create` is exercised by the bot pipeline. */
type OpenAIClientStub = {
  responses: { create: (...args: unknown[]) => unknown };
};

const app = createApp();

const openSockets: ClientSocket[] = [];

const openSocket = async (server: TestServer, user: TestUser) => {
  const socket = connectClient(server.url, { Cookie: user.cookie });
  await waitForEvent(socket, "connect");
  openSockets.push(socket);
  return socket;
};

/** A plain chat reply — no tool call. */
const botReplies = (text: string) => ({
  output: [{ type: "message" }],
  output_text: text,
});

/** A decision to create a document of the given type. */
const botCreatesDocument = (type: "MARKDOWN" | "CANVAS", label: string) => ({
  output: [
    {
      type: "function_call",
      name: "create_document",
      arguments: JSON.stringify({ type, label, prompt: "write something" }),
    },
  ],
  output_text: "",
});

/** The async event stream the markdown generator consumes. */
const markdownStream = (body: string) =>
  (async function* stream() {
    yield { type: "response.output_text.delta", delta: body };
  })();

describe("socket: nimbusbot", () => {
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
    for (const socket of openSockets.splice(0)) socket.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    createMock.mockReset();
    createAiClient.mockReset();

    // Every call to `createAiClient` returns a fake handle whose SDK is the
    // mocked `createMock`. The resolver calls this with provider/model
    // metadata; the fake just preserves it so test assertions can pin
    // "who paid" (which provider/model is being used).
    createAiClient.mockImplementation(
      (options): AiClientHandle => ({
        providerId: options.provider.id,
        modelId: options.model.id,
        source: options.source,
        supportsReasoning: options.model.capabilities.includes("reasoning"),
        client: {
          responses: { create: createMock },
        } as unknown as OpenAIClientStub,
      }),
    );

    alice = await mintUser(app);
    wsId = (await createWorkspace(alice.id)).id;
  });

  /**
   * Buffers every `message:new` for a socket.
   *
   * Registering two `once` listeners for the same event is a trap — the first
   * emission satisfies both. Collecting into an array and polling for a
   * condition is order-safe however fast the bot replies.
   */
  const collectMessages = (socket: ClientSocket) => {
    const seen: Array<{ content: string; userId: string; name?: string }> = [];
    socket.on("message:new", (payload) => seen.push(payload));
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
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out waiting for ${label}`);
  };

  it("answers a plain mention in chat and persists the reply", async () => {
    createMock.mockResolvedValue(botReplies("Hello! How can I help?"));

    const socket = await openSocket(server, alice);
    socket.emit("workspace:join", wsId);
    await waitForEvent(socket, "presence:online_users");

    const seen = collectMessages(socket);
    socket.emit("message:send", {
      workspaceId: wsId,
      content: "@nimbusbot hello",
    });

    // First the user's own echo, then the bot's reply.
    await waitFor(
      () => seen.some((m) => m.userId === process.env.BOT_USERID),
      "bot reply",
    );

    expect(seen[0]).toMatchObject({
      content: "@nimbusbot hello",
      userId: alice.id,
    });
    expect(seen.at(-1)?.content).toBe("Hello! How can I help?");

    const stored = await testPrisma.message.findFirst({
      where: { workspaceId: wsId, userId: process.env.BOT_USERID },
    });
    expect(stored?.content).toBe("Hello! How can I help?");
  });

  it("creates a markdown document and streams the AI lifecycle events", async () => {
    createMock.mockImplementation(
      async (args: { tools?: unknown; stream?: boolean }) => {
        if (args.tools) return botCreatesDocument("MARKDOWN", "Design Notes");
        return markdownStream("# Design Notes\n\nGenerated body.");
      },
    );

    const socket = await openSocket(server, alice);
    socket.emit("workspace:join", wsId);
    await waitForEvent(socket, "presence:online_users");

    const started = waitForEvent<{ type: string; label: string }>(
      socket,
      "doc:ai:start",
      10_000,
    );
    const completed = waitForEvent<{ documentId: string; type: string }>(
      socket,
      "doc:ai:complete",
      10_000,
    );

    socket.emit("message:send", {
      workspaceId: wsId,
      content: "@nimbusbot write design notes",
    });

    await expect(started).resolves.toMatchObject({
      type: "MARKDOWN",
      label: "Design Notes",
    });

    const done = await completed;
    expect(done.type).toBe("MARKDOWN");

    const document = await testPrisma.document.findUnique({
      where: { id: done.documentId },
    });
    expect(document).toMatchObject({
      title: "Design Notes",
      type: "MARKDOWN",
      workspaceId: wsId,
    });
    // The generated body is handed over as the one-shot seed, not written to Yjs.
    expect(document?.initialContent).toContain("Generated body.");
  });

  it("emits doc:ai:error and tells the user when generation fails", async () => {
    createMock.mockImplementation(async (args: { tools?: unknown }) => {
      if (args.tools) return botCreatesDocument("MARKDOWN", "Doomed Doc");
      throw new Error("generation exploded");
    });

    const socket = await openSocket(server, alice);
    socket.emit("workspace:join", wsId);
    await waitForEvent(socket, "presence:online_users");

    // Order of chat traffic: the user's echo, the bot's "creating it now…"
    // acknowledgement, then the bot's failure notice.
    const seen: string[] = [];
    socket.on("message:new", (payload: { content: string }) =>
      seen.push(payload.content),
    );

    const failed = waitForEvent<{ message: string }>(
      socket,
      "doc:ai:error",
      10_000,
    );
    socket.emit("message:send", {
      workspaceId: wsId,
      content: "@nimbusbot make a doc",
    });

    await expect(failed).resolves.toMatchObject({
      message: expect.stringMatching(/generation failed/i),
    });
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(seen.some((content) => /creating the document/i.test(content))).toBe(
      true,
    );
    expect(seen.at(-1)).toMatch(/failed to create the document/i);

    // Nothing was half-created.
    await expect(
      testPrisma.document.count({ where: { workspaceId: wsId } }),
    ).resolves.toBe(0);
  });

  it("refunds the free-tier quota when generation fails after a claim", async () => {
    // Phase 4 change: a generation failure after a successful quota claim
    // must refund the slot, otherwise a provider-side failure would burn
    // one of the user's free document generations. We force the failure on
    // the second LLM call (the markdown generator).
    createMock.mockImplementation(
      async (args: { tools?: unknown; stream?: boolean }) => {
        if (args.tools) return botCreatesDocument("MARKDOWN", "Refund Me");
        throw new Error("generation exploded");
      },
    );

    const socket = await openSocket(server, alice);
    socket.emit("workspace:join", wsId);
    await waitForEvent(socket, "presence:online_users");

    socket.emit("message:send", {
      workspaceId: wsId,
      content: "@nimbusbot refund me",
    });

    // Wait for the failure to surface so the refund path has run.
    await waitForEvent<{ message: string }>(socket, "doc:ai:error", 10_000);
    // A beat for the refund to commit before the assertion.
    await new Promise((resolve) => setTimeout(resolve, 200));

    const user = await testPrisma.user.findUnique({ where: { id: alice.id } });
    expect(user?.freeDocGenerationsUsed).toBe(0);
  });

  it("generates on a BYOK key without spending the free quota, even when it is exhausted", async () => {
    // Regression: the claim used to run unconditionally, so a user with their
    // own credential was charged the operator's free allowance — and, once
    // that allowance was spent, was refused a document they had already paid
    // for, surfacing as "add your own API key" to a user who had one.
    //
    // The counter is deliberately parked at the limit first: if the claim
    // still runs, this test fails at the refusal rather than at the counter.
    await testPrisma.aiCredential.create({
      data: {
        userId: alice.id,
        providerId: "deepseek",
        keyEnvelope: encryptSecret(
          "sk-byok-user-key",
          buildAad(alice.id, "deepseek"),
        ),
        keyId: "testkeyid",
        keyFingerprint: "fp0123456789abcd",
        maskedPreview: "sk-…key",
      },
    });
    await testPrisma.user.update({
      where: { id: alice.id },
      data: { freeDocGenerationsUsed: 5 },
    });

    createMock.mockImplementation(
      async (args: { tools?: unknown; stream?: boolean }) => {
        if (args.tools) return botCreatesDocument("MARKDOWN", "BYOK Doc");
        return markdownStream("# BYOK Doc\n\nPaid for by the user.");
      },
    );

    const socket = await openSocket(server, alice);
    socket.emit("workspace:join", wsId);
    await waitForEvent(socket, "presence:online_users");

    const completed = waitForEvent<{ documentId: string; type: string }>(
      socket,
      "doc:ai:complete",
      10_000,
    );
    socket.emit("message:send", {
      workspaceId: wsId,
      content: "@nimbusbot write me a doc",
    });

    await expect(completed).resolves.toMatchObject({ type: "MARKDOWN" });

    // The BYOK user paid: the operator's allowance is untouched.
    const user = await testPrisma.user.findUnique({ where: { id: alice.id } });
    expect(user?.freeDocGenerationsUsed).toBe(5);
    // And the document really was created.
    await expect(
      testPrisma.document.count({ where: { workspaceId: wsId } }),
    ).resolves.toBe(1);
  });

  it("emits ai:refused targeted to the asking socket when the resolver refuses", async () => {
    // Force the resolver to refuse: clearing `AI_API_KEY` leaves a user with
    // no credential and no operator key, which the resolver returns as
    // `no-operator-key`. `.env.test` sets it, so the deletion is local to
    // this test and restored below.
    const original = process.env.AI_API_KEY;
    delete process.env.AI_API_KEY;

    try {
      const socket = await openSocket(server, alice);
      socket.emit("workspace:join", wsId);
      await waitForEvent(socket, "presence:online_users");

      const refused = waitForEvent<{
        feature: string;
        reason: string;
        message: string;
      }>(socket, "ai:refused", 10_000);

      socket.emit("message:send", {
        workspaceId: wsId,
        content: "@nimbusbot hi",
      });

      await expect(refused).resolves.toMatchObject({
        feature: "chat",
        reason: "no-operator-key",
      });
    } finally {
      process.env.AI_API_KEY = original;
    }
  });

  it("emits ai:refused only to the asking socket, never broadcasts", async () => {
    // The hardest refusal invariant: a quota exhaustion (or any refusal)
    // must not leak to a second tab. We test it with a second client in
    // the same room. To force the refusal deterministically, we drain
    // the user's free quota before the mention.
    for (let i = 0; i < 5; i += 1) {
      await testPrisma.user.update({
        where: { id: alice.id },
        data: { freeDocGenerationsUsed: { increment: 1 } },
      });
    }

    const askingSocket = await openSocket(server, alice);
    askingSocket.emit("workspace:join", wsId);
    await waitForEvent(askingSocket, "presence:online_users");

    // The second tab is the same user — same cookie — but a separate
    // socket. A broadcast would land on both.
    const secondTab = await openSocket(server, alice);
    secondTab.emit("workspace:join", wsId);
    await waitForEvent(secondTab, "presence:online_users");

    // Buffer every event on the second tab; a leak shows up here.
    const leaked: string[] = [];
    secondTab.onAny((event: string) => leaked.push(event));

    const refused = waitForEvent<{ reason: string }>(
      askingSocket,
      "ai:refused",
      10_000,
    );

    // The mention must trigger a tool call so the document path runs —
    // otherwise we would only test the chat refusal, not the quota one.
    createMock.mockResolvedValueOnce(
      botCreatesDocument("MARKDOWN", "Quoted Out"),
    );

    askingSocket.emit("message:send", {
      workspaceId: wsId,
      content: "@nimbusbot write something",
    });

    await expect(refused).resolves.toMatchObject({
      reason: "free-tier-exhausted",
    });

    // Give any spurious broadcast a beat to fire.
    await new Promise((resolve) => setTimeout(resolve, 300));

    // The second tab must not have seen `ai:refused`, `message:new`, or
    // `doc:ai:start`. (The mention itself is broadcast as `message:new`
    // because human chat is never gated on AI entitlement — that is the
    // design rule from the plan.)
    expect(leaked).not.toContain("ai:refused");
    expect(leaked).not.toContain("doc:ai:start");
  });

  it("still delivers the user's own message when the bot fails", async () => {
    createMock.mockRejectedValue(new Error("groq is down"));

    const socket = await openSocket(server, alice);
    socket.emit("workspace:join", wsId);
    await waitForEvent(socket, "presence:online_users");

    const echoed = waitForEvent<{ content: string }>(socket, "message:new");
    socket.emit("message:send", {
      workspaceId: wsId,
      content: "@nimbusbot are you there",
    });

    await expect(echoed).resolves.toMatchObject({
      content: "@nimbusbot are you there",
    });

    // The user's message is persisted regardless of the bot's fate.
    await expect(
      testPrisma.message.count({
        where: { workspaceId: wsId, userId: alice.id },
      }),
    ).resolves.toBe(1);
  });

  it("ignores a message that does not mention the bot", async () => {
    const socket = await openSocket(server, alice);
    socket.emit("workspace:join", wsId);
    await waitForEvent(socket, "presence:online_users");

    const echoed = waitForEvent<{ content: string }>(socket, "message:new");
    socket.emit("message:send", {
      workspaceId: wsId,
      content: "just talking to a human",
    });
    await echoed;

    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(createMock).not.toHaveBeenCalled();
    await expect(
      testPrisma.message.count({
        where: { workspaceId: wsId, userId: process.env.BOT_USERID },
      }),
    ).resolves.toBe(0);
  });
});
