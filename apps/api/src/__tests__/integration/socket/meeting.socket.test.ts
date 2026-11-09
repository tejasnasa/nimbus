/**
 * @module api/__tests__/integration/socket/meeting
 * @description What the workspace hears about a meeting over Socket.IO: it
 * starting and ending, the assistant's state, who is speaking, and the captions
 * themselves, which must arrive in sequence order and only to members.
 *
 * Two real socket clients watch a real server while the agent's side of the
 * conversation is played over HTTP, as the worker does it.
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
import { createApp } from "../../../app";
import { getAgentDispatchClient } from "../../../lib/livekit/client";
import { clearBackstops } from "../../../lib/meeting/lifecycle";
import { issueTicket } from "../../../lib/meeting/tickets";
import {
  addMember,
  closeTestResources,
  connectClient,
  createMeeting,
  createWorkspace,
  createWorkspaceAiCredential,
  joinCall,
  leaveAllCalls,
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

/** Collects every payload of an event until the socket closes. */
const collect = <T>(socket: ClientSocket, event: string): T[] => {
  const seen: T[] = [];
  socket.on(event, (payload: T) => seen.push(payload));
  return seen;
};

describe("socket: meetings", () => {
  let server: TestServer;
  let owner: TestUser;
  let member: TestUser;
  let outsider: TestUser;
  let workspaceId: string;
  let meetingId: string;
  let memberSocket: ClientSocket;
  let outsiderSocket: ClientSocket;

  const open = async (user: TestUser) => {
    const socket = connectClient(server.url, { Cookie: user.cookie });
    await waitForEvent(socket, "connect");
    sockets.push(socket);
    return socket;
  };

  /** The agent redeems a ticket and returns a caller for session routes. */
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
    owner = await mintUser(app, { name: "Olive Owner" });
    member = await mintUser(app, { name: "Mia Member" });
    outsider = await mintUser(app, { name: "Otto Outsider" });
    workspaceId = (await createWorkspace(owner.id)).id;
    await addMember(workspaceId, member.id, "MEMBER");
    await createWorkspaceAiCredential(workspaceId, "openai", {
      verifiedKinds: ["text", "transcription"],
    });
    meetingId = (await createMeeting(workspaceId, { startedById: owner.id })).id;

    memberSocket = await open(member);
    memberSocket.emit("workspace:join", workspaceId);
    await waitForEvent(memberSocket, "presence:online_users");

    outsiderSocket = await open(outsider);
    outsiderSocket.emit("workspace:join", workspaceId);
    await waitForEvent(outsiderSocket, "workspace:error");
  });

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.close();
    clearBackstops();
    await leaveAllCalls();
    vi.restoreAllMocks();
  });

  it("delivers captions to members in sequence order, whatever order they were stored in", async () => {
    const heard = collect<{ meetingId: string; segment: { seq: number; text: string } }>(
      memberSocket,
      "meeting:segment",
    );
    const post = await agentSession();

    await post("/segments", { segments: [line(3), line(1), line(2)] }).expect(200);
    await vi.waitFor(() => expect(heard).toHaveLength(3));

    expect(heard.map((h) => h.segment.seq)).toEqual([1, 2, 3]);
    expect(heard[0]).toMatchObject({
      meetingId,
      segment: { speakerUserId: member.id, speakerName: "Mia", text: "line 1", startMs: 1000 },
    });
  });

  it("sends a replayed batch to no one a second time", async () => {
    const heard = collect<unknown>(memberSocket, "meeting:segment");
    const post = await agentSession();

    await post("/segments", { segments: [line(1), line(2)] });
    await vi.waitFor(() => expect(heard).toHaveLength(2));
    await post("/segments", { segments: [line(1), line(2), line(3)] });
    await vi.waitFor(() => expect(heard).toHaveLength(3));
    await new Promise((r) => setTimeout(r, 150));

    expect(heard).toHaveLength(3);
  });

  it("sends nothing to someone who is not a member", async () => {
    const outsiderHeard: string[] = [];
    for (const event of [
      "meeting:segment",
      "meeting:speaking",
      "meeting:assistant-state",
      "meeting:ended",
    ] as const) {
      outsiderSocket.on(event, () => outsiderHeard.push(event));
    }
    const memberHeard = collect<unknown>(memberSocket, "meeting:segment");
    const post = await agentSession();

    await post("/segments", { segments: [line(1)] });
    await post("/state", { state: "listening", speakingUserIds: [member.id] });
    await vi.waitFor(() => expect(memberHeard).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 150));

    expect(outsiderHeard).toEqual([]);
  });

  it("relays who is speaking, and the assistant state only when it changes", async () => {
    const speaking = collect<{ meetingId: string; userIds: string[] }>(
      memberSocket,
      "meeting:speaking",
    );
    const states = collect<{ meetingId: string; state: string }>(
      memberSocket,
      "meeting:assistant-state",
    );
    const post = await agentSession();

    await post("/state", { state: "listening", speakingUserIds: [] });
    await post("/state", { state: "listening", speakingUserIds: [member.id, owner.id] });
    await post("/state", { state: "thinking" });
    await vi.waitFor(() => expect(states).toHaveLength(2));
    await vi.waitFor(() => expect(speaking).toHaveLength(2));

    expect(states.map((s) => s.state)).toEqual(["listening", "thinking"]);
    expect(speaking[1]).toEqual({ meetingId, userIds: [member.id, owner.id] });
  });

  it("announces the meeting starting and, when stopped, ending", async () => {
    // The seeded live meeting would turn the start into a no-op.
    await testPrisma.meeting.deleteMany({});
    const started = collect<{ id: string; status: string }>(memberSocket, "meeting:started");
    const ended = collect<{ meetingId: string; reason: string }>(memberSocket, "meeting:ended");
    vi.spyOn(getAgentDispatchClient(), "createDispatch").mockResolvedValue({} as never);
    await joinCall(owner, workspaceId);

    const startRes = await request(server.url)
      .post("/api/meetings/assistant/start")
      .set("Cookie", member.cookie)
      .send({ workspaceId })
      .expect(201);
    await vi.waitFor(() => expect(started).toHaveLength(1));
    expect(started[0]).toMatchObject({ id: startRes.body.responseObject.id, status: "LIVE" });

    await request(server.url)
      .post(`/api/meetings/${started[0]!.id}/assistant/stop`)
      .set("Cookie", owner.cookie)
      .expect(200);
    await vi.waitFor(() => expect(ended).toHaveLength(1));
    expect(ended[0]).toEqual({ meetingId: started[0]!.id, reason: "stopped" });
  });

  it("announces an ending the agent reported itself", async () => {
    const ended = collect<{ reason: string }>(memberSocket, "meeting:ended");
    const post = await agentSession();

    await post("/ended", { reason: "budget" });
    await vi.waitFor(() => expect(ended).toHaveLength(1));

    expect(ended[0]!.reason).toBe("budget");
  });
});
