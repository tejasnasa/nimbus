/**
 * @module api/__tests__/integration/http/meetings.diagram.http
 * @description "Draw this discussion": a meeting with notes starts the existing
 * canvas generation and a new canvas document appears, streamed to the workspace
 * as `doc:ai:*` events. Refusals, missing notes, failures and the free
 * allowance are covered. Canvas generation and the resolver are stubs.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { generateMock, resolveMock } = vi.hoisted(() => ({
  generateMock: vi.fn(),
  resolveMock: vi.fn(),
}));

vi.mock("../../../lib/canvasGeneration", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/canvasGeneration")>()),
  generateCanvasDocument: generateMock,
}));
vi.mock("../../../lib/ai/entitlements", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/ai/entitlements")>()),
  resolveAi: resolveMock,
}));

import request from "supertest";
import { createApp } from "../../../app";
import {
  addMember,
  as,
  closeTestResources,
  createMeeting,
  createWorkspace,
  fakeIo,
  mintUser,
  refusingResolver,
  resetDatabase,
  sampleNotes,
  stubResolver,
  testPrisma,
  type TestUser,
} from "@testhelpers";

const app = createApp();
const broadcasts = fakeIo();
app.set("io", broadcasts.io);

afterAll(closeTestResources);

describe("http: meeting diagram", () => {
  let owner: TestUser;
  let member: TestUser;
  let outsider: TestUser;
  let workspaceId: string;
  let meetingId: string;

  const post = (user: TestUser, id = meetingId) =>
    as(app, user).post(`/api/meetings/${id}/diagram`);
  const events = () => broadcasts.emitted.map((e) => e.event);
  const settled = () =>
    vi.waitFor(
      () => {
        expect(events()).toEqual(
          expect.arrayContaining([
            expect.stringMatching(/doc:ai:(complete|error)/),
          ]),
        );
      },
      { timeout: 5_000 },
    );

  beforeEach(async () => {
    await resetDatabase();
    broadcasts.emitted.length = 0;
    generateMock.mockReset();
    resolveMock.mockReset();
    resolveMock.mockImplementation(stubResolver(vi.fn()));
    generateMock.mockImplementation(
      async (options: { onReasoning?: (t: string) => void }) => {
        options.onReasoning?.("thinking...");
        return {
          canvasData: [{ id: "el-1", type: "rectangle" }],
          thinking: "",
        };
      },
    );
    owner = await mintUser(app, { name: "Olive Owner" });
    member = await mintUser(app, { name: "Mia Member" });
    outsider = await mintUser(app, { name: "Otto Outsider" });
    workspaceId = (await createWorkspace(owner.id)).id;
    await addMember(workspaceId, member.id, "MEMBER");
    meetingId = (
      await createMeeting(workspaceId, {
        startedById: owner.id,
        status: "SUMMARIZED",
      })
    ).id;
    await testPrisma.meeting.update({
      where: { id: meetingId },
      data: { title: "Beta launch planning", summary: sampleNotes() as object },
    });
  });

  it("starts generation and creates a new canvas document, streaming like the bot", async () => {
    const res = await post(member);

    expect(res.status).toBe(202);
    expect(res.body.responseObject).toEqual({
      started: true,
      label: "Discussion: Beta launch planning",
    });
    await settled();

    expect(events()).toEqual([
      "doc:ai:start",
      "doc:ai:thinking",
      "document:created",
      "doc:ai:complete",
    ]);
    expect(broadcasts.emitted.every((e) => e.room === workspaceId)).toBe(true);
    const complete = broadcasts.emitted.at(-1)!.payload as {
      documentId: string;
      type: string;
      label: string;
      canvasData: unknown[];
    };
    expect(complete).toMatchObject({
      type: "CANVAS",
      label: "Discussion: Beta launch planning",
      canvasData: [{ id: "el-1", type: "rectangle" }],
    });
    const document = await testPrisma.document.findUniqueOrThrow({
      where: { id: complete.documentId },
    });
    expect(document).toMatchObject({
      type: "CANVAS",
      workspaceId,
      title: "Discussion: Beta launch planning",
    });
    expect(await testPrisma.document.count()).toBe(1);
  });

  it("builds the prompt from the summary, topics, decisions and open questions", async () => {
    await post(member);
    await settled();

    const options = generateMock.mock.calls[0]![0] as {
      prompt: string;
      label: string;
    };
    expect(options.label).toBe("Discussion: Beta launch planning");
    expect(options.prompt).toContain(
      "The team agreed to ship the beta on Friday.",
    );
    expect(options.prompt).toContain("Topics: beta launch; rollback");
    expect(options.prompt).toContain("- Ship the beta on Friday");
    expect(options.prompt).toContain("- Who reviews the rollback plan?");
  });

  it("refuses a meeting without notes and generates nothing", async () => {
    const bare = await createMeeting(workspaceId, {
      startedById: owner.id,
      status: "ENDED",
    });

    const res = await post(member, bare.id);

    expect(res.status).toBe(409);
    expect(generateMock).not.toHaveBeenCalled();
    expect(broadcasts.emitted).toEqual([]);
  });

  it("answers 404 to a non-member and a missing meeting, 401 without a session", async () => {
    expect((await post(outsider)).status).toBe(404);
    expect((await post(member, "missing")).status).toBe(404);
    expect(
      (await request(app).post(`/api/meetings/${meetingId}/diagram`)).status,
    ).toBe(401);
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("answers 403 with the reason when the workspace cannot generate canvases", async () => {
    resolveMock.mockImplementation(refusingResolver());

    const res = await post(member);

    expect(res.status).toBe(403);
    expect(res.body.responseObject).toEqual({
      reason: "no-key",
      cta: "add-key",
    });
    expect(generateMock).not.toHaveBeenCalled();
    expect(broadcasts.emitted).toEqual([]);
  });

  it("tells the workspace when generation fails, and creates nothing", async () => {
    generateMock.mockRejectedValue(new Error("model down"));

    const res = await post(member);
    expect(res.status).toBe(202);
    await settled();

    expect(events()).toEqual(["doc:ai:start", "doc:ai:error"]);
    expect(await testPrisma.document.count()).toBe(0);
  });

  describe("on the operator's free tier", () => {
    beforeEach(() => {
      resolveMock.mockImplementation(stubResolver(vi.fn(), "free"));
    });
    const used = async () =>
      (await testPrisma.user.findUniqueOrThrow({ where: { id: member.id } }))
        .freeDocGenerationsUsed;

    it("spends one of the caller's free generations", async () => {
      await post(member);
      await settled();
      expect(await used()).toBe(1);
    });

    it("returns it when generation fails", async () => {
      generateMock.mockRejectedValue(new Error("model down"));
      await post(member);
      await settled();
      await vi.waitFor(async () => expect(await used()).toBe(0));
    });

    it("refuses with 403 once the allowance is spent", async () => {
      await testPrisma.user.update({
        where: { id: member.id },
        data: { freeDocGenerationsUsed: 1000 },
      });

      const res = await post(member);

      expect(res.status).toBe(403);
      expect(res.body.responseObject).toEqual({
        reason: "free-tier-exhausted",
        cta: "add-key",
      });
      expect(generateMock).not.toHaveBeenCalled();
    });
  });
});
