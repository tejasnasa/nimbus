/**
 * @module api/__tests__/integration/socket/captionLanguage
 * @description Choosing a caption language over Socket.IO: subscribing,
 * changing, unsubscribing and disconnecting update the shared record of what is
 * being read; only live meetings and workspace members are accepted; and
 * translation is requested for exactly the active languages and delivered back
 * over `meeting:translation`.
 *
 * Real sockets, Postgres and Redis. The model client is a stub: no real model is
 * called.
 */
import type { Socket as ClientSocket } from "socket.io-client";
import request from "supertest";
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

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

vi.mock("../../../lib/ai/entitlements", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/ai/entitlements")>()),
  resolveAi: vi.fn(async (input: { workspaceId: string; userId: string }) => ({
    ok: true,
    source: "byok",
    providerId: "openai",
    modelId: "test-model",
    substituted: false,
    handle: {
      providerId: "openai",
      modelId: "test-model",
      source: "byok",
      supportsReasoning: false,
      client: { responses: { create: createMock } },
    },
    meta: {
      workspaceId: input.workspaceId,
      userId: input.userId,
      feature: "meeting",
      providerId: "openai",
      modelId: "test-model",
      source: "byok",
    },
  })),
}));

import { createApp } from "../../../app";
import { activeCaptionLanguages } from "../../../lib/meeting/captionLanguages";
import { clearBackstops } from "../../../lib/meeting/lifecycle";
import { issueTicket } from "../../../lib/meeting/tickets";
import { pubClient } from "../../../lib/redis";
import {
  addMember,
  closeTestResources,
  connectClient,
  createMeeting,
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

const app = createApp();
const bearer = { Authorization: `Bearer ${process.env.NIMBUS_AGENT_SECRET}` };
const sockets: ClientSocket[] = [];

describe("socket: caption language", () => {
  let server: TestServer;
  let owner: TestUser;
  let member: TestUser;
  let outsider: TestUser;
  let workspaceId: string;
  let meetingId: string;

  const open = async (user: TestUser) => {
    const socket = connectClient(server.url, { Cookie: user.cookie });
    await waitForEvent(socket, "connect");
    sockets.push(socket);
    return socket;
  };

  const joined = async (user: TestUser) => {
    const socket = await open(user);
    socket.emit("workspace:join", workspaceId);
    await waitForEvent(socket, "presence:online_users");
    return socket;
  };

  const langsHash = () => pubClient.hgetall(`meeting:${meetingId}:langs`);

  const expectActive = (languages: string[], id = meetingId) =>
    vi.waitFor(async () =>
      expect(await activeCaptionLanguages(id)).toEqual(languages),
    );

  const agentSession = async () => {
    const ticket = await issueTicket(meetingId);
    const redeemed = await request(server.url)
      .post("/internal/agent/redeem")
      .set(bearer)
      .send({ ticket });
    const session = redeemed.body.responseObject.sessionToken as string;
    return (path: string, body: object) =>
      request(server.url)
        .post(`/internal/agent${path}`)
        .set(bearer)
        .set("X-Meeting-Session", session)
        .send(body);
  };

  const line = (seq: number) => ({
    seq,
    speakerUserId: member.id,
    speakerName: "Mia",
    text: `line ${seq}`,
    startMs: seq * 1000,
    endMs: seq * 1000 + 700,
    language: "en",
  });

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await closeTestResources();
  });

  beforeEach(async () => {
    await resetDatabase();
    createMock.mockReset();
    owner = await mintUser(app, { name: "Olive Owner" });
    member = await mintUser(app, { name: "Mia Member" });
    outsider = await mintUser(app, { name: "Otto Outsider" });
    workspaceId = (await createWorkspace(owner.id)).id;
    await addMember(workspaceId, member.id, "MEMBER");
    await createWorkspaceAiCredential(workspaceId, "openai", {
      verifiedKinds: ["text", "transcription"],
    });
    meetingId = (await createMeeting(workspaceId, { startedById: owner.id }))
      .id;
  });

  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.close();
    clearBackstops();
  });

  it("records a member's language and replaces it when they change it", async () => {
    const socket = await joined(member);

    socket.emit("meeting:caption-language", { meetingId, language: "hi" });
    await expectActive(["hi"]);
    socket.emit("meeting:caption-language", { meetingId, language: "es" });
    await expectActive(["es"]);

    expect(Object.keys(await langsHash())).toHaveLength(1);
    expect(await pubClient.ttl(`meeting:${meetingId}:langs`)).toBeGreaterThan(
      0,
    );
  });

  it("unsubscribes on null", async () => {
    const socket = await joined(member);
    socket.emit("meeting:caption-language", { meetingId, language: "hi" });
    await expectActive(["hi"]);

    socket.emit("meeting:caption-language", { meetingId, language: null });
    await expectActive([]);
  });

  it("forgets a socket when it disconnects", async () => {
    const socket = await joined(member);
    socket.emit("meeting:caption-language", { meetingId, language: "hi" });
    await expectActive(["hi"]);

    socket.close();
    await expectActive([]);
  });

  it("refuses a user who is not a member of the workspace", async () => {
    const socket = await open(outsider);
    socket.emit("meeting:caption-language", { meetingId, language: "hi" });
    await new Promise((r) => setTimeout(r, 300));

    expect(await langsHash()).toEqual({});
  });

  it("refuses a member removed from the workspace on their next change", async () => {
    const socket = await joined(member);
    socket.emit("meeting:caption-language", { meetingId, language: "hi" });
    await expectActive(["hi"]);

    await testPrisma.workspaceMember.deleteMany({
      where: { userId: member.id },
    });
    socket.emit("meeting:caption-language", { meetingId, language: "es" });
    await new Promise((r) => setTimeout(r, 300));

    expect(await activeCaptionLanguages(meetingId)).toEqual(["hi"]);
  });

  it("refuses an unsupported language, a malformed payload and a meeting that is not live", async () => {
    const ended = await createMeeting(workspaceId, {
      startedById: owner.id,
      status: "ENDED",
      endedAt: new Date(),
    });
    const socket = await joined(member);

    socket.emit("meeting:caption-language", { meetingId, language: "xx" });
    socket.emit("meeting:caption-language", { meetingId, language: 42 });
    socket.emit("meeting:caption-language", "nonsense");
    socket.emit("meeting:caption-language", {
      meetingId: ended.id,
      language: "hi",
    });
    socket.emit("meeting:caption-language", {
      meetingId: "missing",
      language: "hi",
    });
    await new Promise((r) => setTimeout(r, 300));

    expect(await langsHash()).toEqual({});
    expect(await pubClient.hgetall(`meeting:${ended.id}:langs`)).toEqual({});
  });

  it("holds one subscription per socket, moving it when another meeting is chosen", async () => {
    const otherWorkspace = (await createWorkspace(owner.id, "Other")).id;
    await addMember(otherWorkspace, member.id, "MEMBER");
    const other = await createMeeting(otherWorkspace, {
      startedById: owner.id,
      roomName: "nimbus-ws-other",
    });
    const socket = await joined(member);
    socket.emit("meeting:caption-language", { meetingId, language: "hi" });
    await expectActive(["hi"]);

    socket.emit("meeting:caption-language", {
      meetingId: other.id,
      language: "fr",
    });
    await expectActive(["fr"], other.id);
    await expectActive([]);
  });

  it("requests only the languages being read, and delivers the translations", async () => {
    createMock.mockImplementation(async (req: { input: string }) => {
      const { segments } = JSON.parse(req.input) as {
        segments: Array<{ seq: number; targets: string[] }>;
      };
      return {
        output_text: JSON.stringify({
          translations: Object.fromEntries(
            segments.map((s) => [
              s.seq,
              Object.fromEntries(s.targets.map((t) => [t, `${t}-${s.seq}`])),
            ]),
          ),
        }),
      };
    });
    const memberSocket = await joined(member);
    const ownerSocket = await joined(owner);
    const heard: Array<{ seq: number; language: string; text: string }> = [];
    memberSocket.on("meeting:translation", (p) => heard.push(p));
    memberSocket.emit("meeting:caption-language", {
      meetingId,
      language: "hi",
    });
    ownerSocket.emit("meeting:caption-language", { meetingId, language: "es" });
    await expectActive(["es", "hi"]);
    const post = await agentSession();

    await post("/segments", { segments: [line(1)] }).expect(200);
    await vi.waitFor(() => expect(heard).toHaveLength(2));
    const targetsOf = (call: number) =>
      JSON.parse(createMock.mock.calls[call]![0].input).segments[0].targets;
    expect(targetsOf(0)).toEqual(["es", "hi"]);
    expect(heard.map((h) => `${h.language}:${h.seq}:${h.text}`).sort()).toEqual(
      ["es:1:es-1", "hi:1:hi-1"],
    );

    memberSocket.emit("meeting:caption-language", {
      meetingId,
      language: null,
    });
    await expectActive(["es"]);
    const ownerHeard = waitForEvent<{ seq: number; language: string }>(
      ownerSocket,
      "meeting:translation",
    );
    await post("/segments", { segments: [line(2)] }).expect(200);
    await vi.waitFor(() => expect(createMock).toHaveBeenCalledTimes(2));
    expect(targetsOf(1)).toEqual(["es"]);
    // The batch broadcasts after the model call returns; waiting for it keeps
    // that publish from landing after teardown has closed Redis.
    expect(await ownerHeard).toMatchObject({ seq: 2, language: "es" });
  });
});
