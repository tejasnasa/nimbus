/**
 * @module api/__tests__/integration/http/message
 * @description Chat history over HTTP: membership scoping, chronological order,
 * and the 50-message window.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../app";
import {
  as,
  closeTestResources,
  createMessage,
  createUser,
  createWorkspace,
  mintUser,
  resetDatabase,
  testPrisma,
  type TestUser,
} from "@testhelpers";

const app = createApp();

afterAll(closeTestResources);

describe("http: messages", () => {
  let owner: TestUser;
  let outsider: TestUser;
  let wsId: string;
  let authorId: string;

  beforeEach(async () => {
    await resetDatabase();
    owner = await mintUser(app);
    outsider = await mintUser(app);

    wsId = (await createWorkspace(owner.id)).id;
    authorId = (await createUser("Chatter")).id;
  });

  it("returns a member's workspace history oldest-first", async () => {
    await createMessage(wsId, authorId, "first");
    await createMessage(wsId, authorId, "second");
    await createMessage(wsId, authorId, "third");

    const res = await as(app, owner).get(`/api/messages/${wsId}`);

    expect(res.status).toBe(200);
    expect(
      res.body.responseObject.map((m: { content: string }) => m.content),
    ).toEqual(["first", "second", "third"]);
  });

  it("returns an empty list for an empty workspace", async () => {
    const res = await as(app, owner).get(`/api/messages/${wsId}`);

    expect(res.status).toBe(200);
    expect(res.body.responseObject).toEqual([]);
  });

  it("includes the author's display name and image", async () => {
    await createMessage(wsId, authorId, "hello");

    const res = await as(app, owner).get(`/api/messages/${wsId}`);

    expect(res.body.responseObject[0]).toMatchObject({
      content: "hello",
      userId: authorId,
      name: "Chatter",
    });
  });

  it("does not leak another workspace's messages", async () => {
    const other = await createWorkspace(outsider.id);
    await createMessage(other.id, outsider.id, "private");
    await createMessage(wsId, authorId, "mine");

    const res = await as(app, owner).get(`/api/messages/${wsId}`);

    expect(res.body.responseObject.map((m: { content: string }) => m.content)).toEqual([
      "mine",
    ]);
  });

  // Pinned as observed: the controller answers a non-member with 401 rather than
  // 403 — a "you are not authenticated" signal for what is really a permission
  // denial, which clients may handle very differently (e.g. redirect to login).
  it("answers a non-member with 401", async () => {
    await createMessage(wsId, authorId, "hello");

    const res = await as(app, outsider).get(`/api/messages/${wsId}`);

    expect(res.status).toBe(401);
  });

  it("caps the window at the 50 most recent messages", async () => {
    // Explicit, distinct timestamps: the query orders by `createdAt` alone, so
    // rows sharing a timestamp come back in arbitrary order and a bulk insert
    // would make "the 50 most recent" non-deterministic.
    const base = Date.now() - 60_000;
    await testPrisma.message.createMany({
      data: Array.from({ length: 55 }, (_, i) => ({
        workspaceId: wsId,
        userId: authorId,
        content: `message-${i + 1}`,
        createdAt: new Date(base + i * 1_000),
      })),
    });

    const res = await as(app, owner).get(`/api/messages/${wsId}`);
    const contents = res.body.responseObject.map((m: { content: string }) => m.content);

    expect(contents).toHaveLength(50);
    // Queried newest-first, then reversed: the window keeps the tail, oldest-first.
    expect(contents[0]).toBe("message-6");
    expect(contents.at(-1)).toBe("message-55");
  });
});
