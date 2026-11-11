/**
 * @module api/__tests__/integration/persistence/backfillDocumentSearch
 * @description The search-text backfill against the test database: its
 * arguments refuse to start without an explicit `DATABASE_URL` and never echo
 * credentials, a dry run reports without writing, and a real run fills search
 * text from Yjs state, canvas data and unconsumed markdown seeds, then has
 * nothing left to do on a rerun.
 */
import * as Y from "yjs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  BACKFILL_USAGE,
  backfillDocumentSearch,
  parseBackfillArgs,
} from "../../../lib/documentBackfill";
import {
  closeTestResources,
  createDocument,
  createUser,
  createWorkspace,
  resetDatabase,
  testPrisma,
} from "@testhelpers";

describe("backfill_document_search", () => {
  describe("arguments", () => {
    it("refuses to start without an explicit DATABASE_URL", () => {
      expect(parseBackfillArgs([], {})).toEqual({
        ok: false,
        message: BACKFILL_USAGE,
      });
    });

    it("refuses unknown flags and an unparseable URL", () => {
      expect(
        parseBackfillArgs(["--force"], { DATABASE_URL: "postgresql://h/db" }),
      ).toMatchObject({ ok: false });
      expect(
        parseBackfillArgs([], { DATABASE_URL: "not a url" }),
      ).toMatchObject({ ok: false, message: expect.stringContaining("valid") });
    });

    it("reads the flags and names the target without its credentials", () => {
      const args = parseBackfillArgs(["--dry-run", "--all"], {
        DATABASE_URL: "postgresql://user:secret@db.internal:6543/app",
      });
      expect(args).toMatchObject({
        ok: true,
        dryRun: true,
        all: true,
        target: "db.internal:6543/app",
      });
      expect(JSON.stringify(args.ok && args.target)).not.toContain("secret");
      expect(
        parseBackfillArgs([], { DATABASE_URL: "postgresql://h/db" }),
      ).toMatchObject({
        ok: true,
        dryRun: false,
        all: false,
        target: "h:5432/db",
      });
    });
  });

  describe("run", () => {
    let wsId: string;

    beforeEach(async () => {
      await resetDatabase();
      wsId = (await createWorkspace((await createUser("Owner")).id)).id;
    });

    afterAll(closeTestResources);

    it("dry-runs without writing, then fills text from every source", async () => {
      const yjs = new Y.Doc();
      const paragraph = new Y.XmlElement("paragraph");
      yjs.getXmlFragment("prosemirror").insert(0, [paragraph]);
      const text = new Y.XmlText();
      paragraph.insert(0, [text]);
      text.insert(0, "from yjs state");
      const md = await createDocument(wsId, { type: "MARKDOWN" });
      await testPrisma.document.update({
        where: { id: md.id },
        data: { yjsState: Buffer.from(Y.encodeStateAsUpdate(yjs)) },
      });
      const seeded = await createDocument(wsId, {
        type: "MARKDOWN",
        initialContent: "# Seed heading\n\nseed body",
      });
      const canvas = await createDocument(wsId, {
        type: "CANVAS",
        canvasData: [{ id: "t", type: "text", text: "canvas label" }],
      });

      const dryLog: string[] = [];
      await expect(
        backfillDocumentSearch(testPrisma, {
          dryRun: true,
          all: false,
          log: (line) => dryLog.push(line),
        }),
      ).resolves.toEqual({ inspected: 3, changed: 3 });
      expect(dryLog).toContain("Would update 3 document(s).");
      await expect(
        testPrisma.document.count({ where: { searchText: { not: null } } }),
      ).resolves.toBe(0);

      await backfillDocumentSearch(testPrisma, {
        dryRun: false,
        all: false,
        log: () => undefined,
      });
      const rows = await testPrisma.document.findMany({
        where: { id: { in: [md.id, seeded.id, canvas.id] } },
      });
      const byId = new Map(rows.map((row) => [row.id, row.searchText]));
      expect(byId.get(md.id)).toBe("from yjs state");
      expect(byId.get(seeded.id)).toBe("Seed heading\n\nseed body");
      expect(byId.get(canvas.id)).toBe("canvas label");

      const againLog: string[] = [];
      await expect(
        backfillDocumentSearch(testPrisma, {
          dryRun: false,
          all: false,
          log: (line) => againLog.push(line),
        }),
      ).resolves.toEqual({ inspected: 0, changed: 0 });
      expect(againLog).toContain("0 document(s) to inspect.");
    });

    it("recomputes documents that already have text only with all", async () => {
      const canvas = await createDocument(wsId, {
        type: "CANVAS",
        canvasData: [{ id: "t", type: "text", text: "fresh label" }],
      });
      await testPrisma.document.update({
        where: { id: canvas.id },
        data: { searchText: "stale label" },
      });
      const quiet = { dryRun: false, log: () => undefined };

      await expect(
        backfillDocumentSearch(testPrisma, { ...quiet, all: false }),
      ).resolves.toEqual({ inspected: 0, changed: 0 });
      await expect(
        backfillDocumentSearch(testPrisma, { ...quiet, all: true }),
      ).resolves.toEqual({ inspected: 1, changed: 1 });
      await expect(
        testPrisma.document.findUnique({ where: { id: canvas.id } }),
      ).resolves.toMatchObject({ searchText: "fresh label" });
    });
  });
});
