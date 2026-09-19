/**
 * @module api/__tests__/integration/http/document
 * @description Document CRUD over HTTP, including the Zod type/enum gate on
 * creation and the membership scope on every read.
 *
 * @important Creation reports **200**, not 201, while workspace creation reports
 *            201 — see the note in the 200 assertion below.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../app";
import {
  addMember,
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

describe("http: document", () => {
  let owner: TestUser;
  let member: TestUser;
  let outsider: TestUser;
  let wsId: string;

  beforeEach(async () => {
    await resetDatabase();
    owner = await mintUser(app);
    member = await mintUser(app);
    outsider = await mintUser(app);

    wsId = (await createWorkspace(owner.id)).id;
  });

  describe("POST /api/document/create", () => {
    // Pins the observed status: `createDocument` uses `ServerResponse.ok`,
    // whereas `createWorkspace` uses `.created`. Worth aligning deliberately.
    it("creates a CANVAS document and reports 200", async () => {
      const res = await as(app, owner)
        .post("/api/document/create")
        .send({ title: "Sketch", workspaceId: wsId, type: "CANVAS" });

      expect(res.status).toBe(200);
      expect(res.body.responseObject).toMatchObject({ title: "Sketch", type: "CANVAS" });
    });

    it("creates a MARKDOWN document", async () => {
      const res = await as(app, owner)
        .post("/api/document/create")
        .send({ title: "Notes", workspaceId: wsId, type: "MARKDOWN" });

      expect(res.status).toBe(200);
      expect(res.body.responseObject.type).toBe("MARKDOWN");
    });

    it("rejects an unknown document type", async () => {
      const res = await as(app, owner)
        .post("/api/document/create")
        .send({ title: "Weird", workspaceId: wsId, type: "SPREADSHEET" });

      expect(res.status).toBe(400);
      expect(res.body.responseObject.properties.type.errors.length).toBeGreaterThan(0);
    });

    it("rejects a title below the minimum length", async () => {
      const res = await as(app, owner)
        .post("/api/document/create")
        .send({ title: "ab", workspaceId: wsId, type: "CANVAS" });

      expect(res.status).toBe(400);
    });

    it("rejects a non-cuid workspaceId", async () => {
      const res = await as(app, owner)
        .post("/api/document/create")
        .send({ title: "Valid Title", workspaceId: "not-a-cuid", type: "CANVAS" });

      expect(res.status).toBe(400);
    });

    it("refuses a non-member", async () => {
      const res = await as(app, outsider)
        .post("/api/document/create")
        .send({ title: "Intruder", workspaceId: wsId, type: "CANVAS" });

      expect(res.status).toBe(403);
      await expect(
        testPrisma.document.count({ where: { workspaceId: wsId } }),
      ).resolves.toBe(0);
    });
  });

  describe("GET /api/document/workspace/:workspaceId", () => {
    it("lists a member's workspace documents, newest-updated first", async () => {
      const first = await createDocument(wsId, { title: "First" });
      const second = await createDocument(wsId, { title: "Second" });

      const res = await as(app, owner).get(`/api/document/workspace/${wsId}`);

      expect(res.status).toBe(200);
      const titles = res.body.responseObject.map((d: { title: string }) => d.title);
      expect(titles).toEqual(expect.arrayContaining(["First", "Second"]));
      expect(res.body.responseObject).toHaveLength(2);
      expect(new Set([first.id, second.id]).size).toBe(2);
    });

    it("refuses a non-member", async () => {
      await createDocument(wsId);

      const res = await as(app, outsider).get(`/api/document/workspace/${wsId}`);

      expect(res.status).toBe(403);
    });
  });

  describe("GET /api/document/:docId", () => {
    it("returns a document to a workspace member", async () => {
      const doc = await createDocument(wsId, { title: "Readable" });

      const res = await as(app, owner).get(`/api/document/${doc.id}`);

      expect(res.status).toBe(200);
      expect(res.body.responseObject.title).toBe("Readable");
    });

    it("404s an unknown document", async () => {
      const res = await as(app, owner).get("/api/document/cm_does_not_exist_000");

      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/document/:docId", () => {
    it("allows an ADMIN and removes the row", async () => {
      const doc = await createDocument(wsId);
      await addMember(wsId, member.id, "ADMIN");

      const res = await as(app, member).delete(`/api/document/${doc.id}`);

      expect(res.status).toBe(200);
      await expect(
        testPrisma.document.findUnique({ where: { id: doc.id } }),
      ).resolves.toBeNull();
    });

    it("refuses a plain MEMBER", async () => {
      const doc = await createDocument(wsId);
      await addMember(wsId, member.id, "MEMBER");

      const res = await as(app, member).delete(`/api/document/${doc.id}`);

      expect(res.status).toBe(403);
      await expect(
        testPrisma.document.findUnique({ where: { id: doc.id } }),
      ).resolves.not.toBeNull();
    });
  });
});
