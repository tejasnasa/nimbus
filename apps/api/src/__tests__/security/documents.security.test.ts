/**
 * @module api/__tests__/security/documents
 * @description Cross-workspace isolation of the document rename, export and
 * search routes: a user from another workspace gets the same 404 as for a
 * document that does not exist, and nothing is changed or leaked.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../app";
import {
  as,
  closeTestResources,
  createDocument,
  createWorkspace,
  mintUser,
  resetDatabase,
  testPrisma,
  type TestUser,
} from "@testhelpers";

const app = createApp();

afterAll(closeTestResources);

describe("security: document routes across workspaces", () => {
  let owner: TestUser;
  let intruder: TestUser;
  let wsId: string;
  let docId: string;

  beforeEach(async () => {
    await resetDatabase();
    owner = await mintUser(app);
    intruder = await mintUser(app);
    wsId = (await createWorkspace(owner.id)).id;
    await createWorkspace(intruder.id);
    docId = (
      await createDocument(wsId, {
        type: "MARKDOWN",
        title: "Confidential plan",
        searchText: "launch codename aurora",
        initialContent: "launch codename aurora",
      })
    ).id;
  });

  it("does not let another workspace's member rename a document", async () => {
    const res = await as(app, intruder)
      .patch(`/api/document/${docId}`)
      .send({ title: "Defaced" });

    expect(res.status).toBe(404);
    await expect(
      testPrisma.document.findUniqueOrThrow({ where: { id: docId } }),
    ).resolves.toMatchObject({ title: "Confidential plan" });
  });

  it("does not export another workspace's document", async () => {
    const res = await as(app, intruder).get(`/api/document/${docId}/export`);

    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain("aurora");
  });

  it("does not search another workspace, even for a word only it contains", async () => {
    const res = await as(app, intruder).get(
      `/api/document/search?workspaceId=${wsId}&q=aurora`,
    );

    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain("aurora");
  });
});
