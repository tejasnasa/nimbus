/**
 * @module api/__tests__/integration/socket/bot
 * @description The `@nimbusbot` mention pipeline end to end: a mention is
 * answered in chat, and a `create_document` decision produces a real Document
 * row plus the `doc:ai:*` streaming events the client renders.
 *
 * Both LLM clients are mocked at the module boundary, dispatching on the request
 * shape — the bot decision carries `tools`, the markdown generator asks for a
 * stream.
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

const { groqCreate, openaiCreate } = vi.hoisted(() => ({
  groqCreate: vi.fn(),
  openaiCreate: vi.fn(),
}));

vi.mock("../../../lib/groqClient", () => ({
  default: { responses: { create: groqCreate } },
}));
vi.mock("../../../lib/openaiClient", () => ({
  default: { responses: { create: openaiCreate } },
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

const app = createApp();

const openSockets: ClientSocket[] = [];

const openSocket = async (server: TestServer, user: TestUser) => {
  const socket = connectClient(server.url, { Cookie: user.cookie });
  await waitForEvent(socket, "connect");
  openSockets.push(socket);
  return socket;
};

/** A plain chat reply — no tool call. */
const botReplies = (text: string) => ({ output: [{ type: "message" }], output_text: text });

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
    groqCreate.mockReset();
    openaiCreate.mockReset();

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
  const waitFor = async (done: () => boolean, label: string, timeoutMs = 10_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (done()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out waiting for ${label}`);
  };

  it("answers a plain mention in chat and persists the reply", async () => {
    groqCreate.mockResolvedValue(botReplies("Hello! How can I help?"));

    const socket = await openSocket(server, alice);
    socket.emit("workspace:join", wsId);
    await waitForEvent(socket, "presence:online_users");

    const seen = collectMessages(socket);
    socket.emit("message:send", { workspaceId: wsId, content: "@nimbusbot hello" });

    // First the user's own echo, then the bot's reply.
    await waitFor(() => seen.some((m) => m.userId === process.env.BOT_USERID), "bot reply");

    expect(seen[0]).toMatchObject({ content: "@nimbusbot hello", userId: alice.id });
    expect(seen.at(-1)?.content).toBe("Hello! How can I help?");

    const stored = await testPrisma.message.findFirst({
      where: { workspaceId: wsId, userId: process.env.BOT_USERID },
    });
    expect(stored?.content).toBe("Hello! How can I help?");
  });

  it("creates a markdown document and streams the AI lifecycle events", async () => {
    groqCreate.mockImplementation(async (args: { tools?: unknown; stream?: boolean }) => {
      if (args.tools) return botCreatesDocument("MARKDOWN", "Design Notes");
      return markdownStream("# Design Notes\n\nGenerated body.");
    });

    const socket = await openSocket(server, alice);
    socket.emit("workspace:join", wsId);
    await waitForEvent(socket, "presence:online_users");

    const started = waitForEvent<{ type: string; label: string }>(socket, "doc:ai:start", 10_000);
    const completed = waitForEvent<{ documentId: string; type: string }>(
      socket,
      "doc:ai:complete",
      10_000,
    );

    socket.emit("message:send", { workspaceId: wsId, content: "@nimbusbot write design notes" });

    await expect(started).resolves.toMatchObject({ type: "MARKDOWN", label: "Design Notes" });

    const done = await completed;
    expect(done.type).toBe("MARKDOWN");

    const document = await testPrisma.document.findUnique({ where: { id: done.documentId } });
    expect(document).toMatchObject({
      title: "Design Notes",
      type: "MARKDOWN",
      workspaceId: wsId,
    });
    // The generated body is handed over as the one-shot seed, not written to Yjs.
    expect(document?.initialContent).toContain("Generated body.");
  });

  it("emits doc:ai:error and tells the user when generation fails", async () => {
    groqCreate.mockImplementation(async (args: { tools?: unknown }) => {
      if (args.tools) return botCreatesDocument("MARKDOWN", "Doomed Doc");
      throw new Error("generation exploded");
    });

    const socket = await openSocket(server, alice);
    socket.emit("workspace:join", wsId);
    await waitForEvent(socket, "presence:online_users");

    // Order of chat traffic: the user's echo, the bot's "creating it now…"
    // acknowledgement, then the bot's failure notice.
    const seen: string[] = [];
    socket.on("message:new", (payload: { content: string }) => seen.push(payload.content));

    const failed = waitForEvent<{ message: string }>(socket, "doc:ai:error", 10_000);
    socket.emit("message:send", { workspaceId: wsId, content: "@nimbusbot make a doc" });

    await expect(failed).resolves.toMatchObject({
      message: expect.stringMatching(/generation failed/i),
    });
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(seen.some((content) => /creating the document/i.test(content))).toBe(true);
    expect(seen.at(-1)).toMatch(/failed to create the document/i);

    // Nothing was half-created.
    await expect(
      testPrisma.document.count({ where: { workspaceId: wsId } }),
    ).resolves.toBe(0);
  });

  it("still delivers the user's own message when the bot fails", async () => {
    groqCreate.mockRejectedValue(new Error("groq is down"));

    const socket = await openSocket(server, alice);
    socket.emit("workspace:join", wsId);
    await waitForEvent(socket, "presence:online_users");

    const echoed = waitForEvent<{ content: string }>(socket, "message:new");
    socket.emit("message:send", { workspaceId: wsId, content: "@nimbusbot are you there" });

    await expect(echoed).resolves.toMatchObject({ content: "@nimbusbot are you there" });

    // The user's message is persisted regardless of the bot's fate.
    await expect(
      testPrisma.message.count({ where: { workspaceId: wsId, userId: alice.id } }),
    ).resolves.toBe(1);
  });

  it("ignores a message that does not mention the bot", async () => {
    const socket = await openSocket(server, alice);
    socket.emit("workspace:join", wsId);
    await waitForEvent(socket, "presence:online_users");

    const echoed = waitForEvent<{ content: string }>(socket, "message:new");
    socket.emit("message:send", { workspaceId: wsId, content: "just talking to a human" });
    await echoed;

    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(groqCreate).not.toHaveBeenCalled();
    await expect(
      testPrisma.message.count({ where: { workspaceId: wsId, userId: process.env.BOT_USERID } }),
    ).resolves.toBe(0);
  });
});
