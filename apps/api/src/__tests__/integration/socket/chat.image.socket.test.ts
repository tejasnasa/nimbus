/**
 * @module api/__tests__/integration/socket/chat.image
 * @description Images in chat, end to end over a real socket server: a message
 * with an image from the workspace's own folder persists and broadcasts, any
 * other URL is refused, and a `@nimbusbot` mention with an image is answered by
 * the vision model and can become a canvas.
 *
 * The SDK client is mocked at the `clientFactory` boundary exactly as in the
 * bot suite: the bot's routing call carries `tools`, the image-to-canvas call
 * asks for a stream. No provider, no Cloudinary and no network is involved.
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
  createWorkspaceAiCredential,
  mintUser,
  resetDatabase,
  startTestServer,
  testPrisma,
  waitForEvent,
  type TestServer,
  type TestUser,
} from "@testhelpers";
import type { AiClientHandle } from "../../../lib/ai/clientFactory";

const app = createApp();
const openSockets: ClientSocket[] = [];

/** Both values come from the committed `.env.test`. */
const CLOUD = "test-cloudinary-cloud-name";
const BOT_USER_ID = "test-bot-user-id";
const imageIn = (workspaceId: string, file = "abc123") =>
  `https://res.cloudinary.com/${CLOUD}/image/upload/v1700000000/nimbus/chat/${workspaceId}/${file}.jpg`;

const openSocket = async (server: TestServer, user: TestUser) => {
  const socket = connectClient(server.url, { Cookie: user.cookie });
  await waitForEvent(socket, "connect");
  openSockets.push(socket);
  return socket;
};

const waitFor = async (
  done: () => boolean | Promise<boolean>,
  label: string,
  timeoutMs = 10_000,
) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await done()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${label}`);
};

const botReplies = (text: string) => ({
  output: [{ type: "message" }],
  output_text: text,
});

const botDiagramsImage = () => ({
  output: [
    {
      type: "function_call",
      name: "create_document",
      arguments: JSON.stringify({
        type: "CANVAS",
        label: "Photo flow",
        prompt: "turn this into a diagram",
        fromImage: true,
      }),
    },
  ],
  output_text: "",
});

/** The streamed reply of the image-to-canvas call. */
const imageStream = (text: string) =>
  (async function* stream() {
    yield { type: "response.output_text.delta", delta: text };
    yield {
      type: "response.completed",
      response: {
        output: [],
        usage: { input_tokens: 900, output_tokens: 120 },
      },
    };
  })();

const DIAGRAM = JSON.stringify({
  direction: "TB",
  nodes: [
    { id: "a", shape: "rectangle", label: "Browser" },
    { id: "b", shape: "rectangle", label: "API" },
  ],
  edges: [{ from: "a", to: "b" }],
});

type Part = { type: string; image_url?: string; detail?: string };
type CallArgs = {
  tools?: unknown;
  stream?: boolean;
  instructions?: string;
  input: Array<{ role: string; content: string | Part[] }>;
};

const imagePartsIn = (args: CallArgs): Part[] =>
  args.input.flatMap((item) =>
    Array.isArray(item.content)
      ? item.content.filter((p) => p.type === "input_image")
      : [],
  );

describe("socket: chat images", () => {
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

  const joined = async () => {
    const socket = await openSocket(server, alice);
    socket.emit("workspace:join", wsId);
    await waitForEvent(socket, "presence:online_users");
    return socket;
  };

  it("persists and broadcasts a message carrying the workspace's own image", async () => {
    const socket = await joined();
    const url = imageIn(wsId);

    const echoed = waitForEvent<{ imageUrl: string; content: string }>(
      socket,
      "message:new",
    );
    socket.emit("message:send", {
      workspaceId: wsId,
      content: "look at this",
      imageUrl: url,
    });

    await expect(echoed).resolves.toMatchObject({
      imageUrl: url,
      content: "look at this",
    });
    const stored = await testPrisma.message.findFirst({
      where: { workspaceId: wsId },
    });
    expect(stored?.imageUrl).toBe(url);
  });

  it("accepts an image with no text", async () => {
    const socket = await joined();

    const echoed = waitForEvent<{ imageUrl: string }>(socket, "message:new");
    socket.emit("message:send", {
      workspaceId: wsId,
      content: "",
      imageUrl: imageIn(wsId),
    });

    await expect(echoed).resolves.toMatchObject({ imageUrl: imageIn(wsId) });
  });

  it("rejects an empty message with no image", async () => {
    const socket = await joined();

    socket.emit("message:send", { workspaceId: wsId, content: "   " });
    await new Promise((resolve) => setTimeout(resolve, 300));

    await expect(
      testPrisma.message.count({ where: { workspaceId: wsId } }),
    ).resolves.toBe(0);
  });

  it.each([
    ["another workspace's folder", (id: string) => imageIn(`${id}x`)],
    [
      "another cloud",
      (id: string) =>
        `https://res.cloudinary.com/someone-else/image/upload/v1/nimbus/chat/${id}/a.jpg`,
    ],
    [
      "another host",
      (id: string) => `https://evil.example/nimbus/chat/${id}/a.jpg`,
    ],
    ["plain http", (id: string) => imageIn(id).replace("https://", "http://")],
  ])("refuses an image from %s and stores nothing", async (_label, make) => {
    const socket = await joined();

    const refused = waitForEvent<string>(socket, "workspace:error");
    socket.emit("message:send", {
      workspaceId: wsId,
      content: "@nimbusbot read this",
      imageUrl: make(wsId),
    });

    await expect(refused).resolves.toMatch(/cannot be used/);
    await new Promise((resolve) => setTimeout(resolve, 200));
    await expect(
      testPrisma.message.count({ where: { workspaceId: wsId } }),
    ).resolves.toBe(0);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("does not let a non-member post an image", async () => {
    const mallory = await mintUser(app);
    const socket = await openSocket(server, mallory);

    socket.emit("message:send", {
      workspaceId: wsId,
      content: "hi",
      imageUrl: imageIn(wsId),
    });
    await new Promise((resolve) => setTimeout(resolve, 300));

    await expect(
      testPrisma.message.count({ where: { workspaceId: wsId } }),
    ).resolves.toBe(0);
  });

  it("answers a mention with an image through the vision model, sending only the latest image", async () => {
    // An older message with an image already sits in history.
    await testPrisma.message.create({
      data: {
        content: "an earlier picture",
        userId: alice.id,
        workspaceId: wsId,
        imageUrl: imageIn(wsId, "older"),
      },
    });
    createMock.mockResolvedValue(botReplies("That is a whiteboard."));

    const socket = await joined();
    const latest = imageIn(wsId, "latest");
    socket.emit("message:send", {
      workspaceId: wsId,
      content: "@nimbusbot what is this?",
      imageUrl: latest,
    });

    await waitFor(() => createMock.mock.calls.length > 0, "the bot call");
    const args = createMock.mock.calls[0]![0] as CallArgs;

    const images = imagePartsIn(args);
    expect(images).toHaveLength(1);
    expect(images[0]!.image_url).toBe(latest);
    // The earlier image stays in history as text only.
    expect(JSON.stringify(args.input)).toContain("[attached an image]");

    await waitFor(
      async () =>
        (await testPrisma.message.count({
          where: { workspaceId: wsId, userId: BOT_USER_ID },
        })) > 0,
      "the bot reply",
    );
    const calls = await testPrisma.aiCall.findMany({
      where: { workspaceId: wsId },
    });
    expect(calls.map((c) => c.feature)).toEqual(["VISION"]);
    expect(calls[0]!.userId).toBe(alice.id);
  });

  it("offers fromImage only when the message has an image", async () => {
    createMock.mockResolvedValue(botReplies("ok"));
    const socket = await joined();

    socket.emit("message:send", {
      workspaceId: wsId,
      content: "@nimbusbot hello",
    });
    await waitFor(() => createMock.mock.calls.length > 0, "a plain bot call");
    const plain = createMock.mock.calls[0]![0] as {
      tools: Array<{ parameters: { properties: Record<string, unknown> } }>;
    };
    expect(plain.tools[0]!.parameters.properties).not.toHaveProperty(
      "fromImage",
    );

    createMock.mockClear();
    socket.emit("message:send", {
      workspaceId: wsId,
      content: "@nimbusbot diagram this",
      imageUrl: imageIn(wsId),
    });
    await waitFor(() => createMock.mock.calls.length > 0, "an image bot call");
    const withImage = createMock.mock.calls[0]![0] as typeof plain;
    expect(withImage.tools[0]!.parameters.properties).toHaveProperty(
      "fromImage",
    );
  });

  it("turns an image into a canvas and spends one free generation", async () => {
    const url = imageIn(wsId, "board");
    createMock.mockImplementation(async (args: CallArgs) => {
      if (args.tools) return botDiagramsImage();
      return imageStream(DIAGRAM);
    });

    const socket = await joined();
    const started = waitForEvent<{ type: string; label: string }>(
      socket,
      "doc:ai:start",
      10_000,
    );
    const completed = waitForEvent<{
      documentId: string;
      type: string;
      canvasData: unknown[];
    }>(socket, "doc:ai:complete", 10_000);

    socket.emit("message:send", {
      workspaceId: wsId,
      content: "@nimbusbot turn this into a diagram",
      imageUrl: url,
    });

    await expect(started).resolves.toMatchObject({
      type: "CANVAS",
      label: "Photo flow",
    });
    const done = await completed;
    expect(done.type).toBe("CANVAS");
    // Two nodes with their labels, plus one arrow.
    expect(done.canvasData).toHaveLength(5);

    const document = await testPrisma.document.findUnique({
      where: { id: done.documentId },
    });
    expect(document).toMatchObject({ title: "Photo flow", type: "CANVAS" });

    // The generation call sent the image at low detail, as JSON.
    const generation = createMock.mock.calls
      .map((c) => c[0] as CallArgs & { text?: unknown })
      .find((a) => a.stream)!;
    expect(imagePartsIn(generation)).toEqual([
      { type: "input_image", image_url: url, detail: "low" },
    ]);

    const user = await testPrisma.user.findUnique({ where: { id: alice.id } });
    expect(user?.freeDocGenerationsUsed).toBe(1);

    const features = (
      await testPrisma.aiCall.findMany({ where: { workspaceId: wsId } })
    ).map((c) => c.feature);
    expect(features).toEqual(["VISION", "VISION"]);
  });

  it("answers in chat, refunds the allowance and makes no document when the image is not a diagram", async () => {
    createMock.mockImplementation(async (args: CallArgs) => {
      if (args.tools) return botDiagramsImage();
      return imageStream(
        JSON.stringify({ notADiagram: true, reason: "it is a mountain lake" }),
      );
    });

    const socket = await joined();
    const seen: string[] = [];
    socket.on("message:new", (m: { content: string }) => seen.push(m.content));
    const errored = waitForEvent<{ message: string }>(
      socket,
      "doc:ai:error",
      10_000,
    );

    socket.emit("message:send", {
      workspaceId: wsId,
      content: "@nimbusbot turn this into a diagram",
      imageUrl: imageIn(wsId),
    });

    await expect(errored).resolves.toMatchObject({
      message: expect.stringContaining("mountain lake"),
    });
    await waitFor(
      () => seen.some((c) => c.includes("doesn't look like a diagram")),
      "the explanatory bot message",
    );

    await expect(
      testPrisma.document.count({ where: { title: "Photo flow" } }),
    ).resolves.toBe(0);
    const user = await testPrisma.user.findUnique({ where: { id: alice.id } });
    expect(user?.freeDocGenerationsUsed).toBe(0);
    // A model that answers "not a diagram" has still succeeded.
    const generation = await testPrisma.aiCall.findMany({
      where: { workspaceId: wsId, status: "ERROR" },
    });
    expect(generation).toHaveLength(0);
  });

  it("falls back to chat and points at the AI settings when the workspace cannot read images", async () => {
    // A key for a provider whose models cannot see: vision has no capable
    // model, while chat still works.
    await createWorkspaceAiCredential(wsId, "groq");
    createMock.mockResolvedValue(botReplies("I cannot see the image."));

    const socket = await joined();
    const refused = waitForEvent<{
      feature: string;
      reason: string;
      cta: string | null;
      message: string;
    }>(socket, "ai:refused", 10_000);

    socket.emit("message:send", {
      workspaceId: wsId,
      content: "@nimbusbot what is in this picture?",
      imageUrl: imageIn(wsId),
    });

    await expect(refused).resolves.toMatchObject({
      feature: "vision",
      reason: "no-capable-model",
      cta: "manage-ai",
    });

    await waitFor(() => createMock.mock.calls.length > 0, "the chat fallback");
    const args = createMock.mock.calls[0]![0] as CallArgs;
    expect(imagePartsIn(args)).toHaveLength(0);
    expect(args.instructions).toContain("cannot see");

    await waitFor(
      async () =>
        (await testPrisma.message.count({
          where: { workspaceId: wsId, userId: BOT_USER_ID },
        })) > 0,
      "the fallback reply",
    );
    const rows = await testPrisma.aiCall.findMany({
      where: { workspaceId: wsId },
    });
    expect(rows.map((r) => [r.feature, r.status]).sort()).toEqual([
      ["CHAT", "OK"],
      ["VISION", "REFUSED"],
    ]);
  });
});
