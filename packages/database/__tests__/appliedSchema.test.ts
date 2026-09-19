import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client";
import { createTestClient } from "./dbTestUtils";

/**
 * Verifies what the migrations actually deployed, by reading Postgres'
 * catalogs. The schema file can be right while the database is stale (an
 * unapplied migration, a hand-edited column), so every column type, enum
 * label and referential action asserted here is read back from the server.
 */
let client: PrismaClient;

/** `information_schema` row for one column. */
interface ColumnRow {
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: string;
}

interface ConstraintRow {
  conname: string;
  contype: string;
  confdeltype: string | null;
  definition: string;
}

beforeAll(() => {
  client = createTestClient();
});

afterAll(async () => {
  await client.$disconnect();
});

const columnsOf = (table: string) =>
  client.$queryRaw<ColumnRow[]>`
    SELECT column_name, data_type, udt_name, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}
    ORDER BY ordinal_position
  `;

const column = async (table: string, name: string) => {
  const found = (await columnsOf(table)).find((c) => c.column_name === name);
  if (!found) throw new Error(`No column ${table}.${name}`);
  return found;
};

const constraintsOf = (table: string) =>
  client.$queryRaw<ConstraintRow[]>`
    SELECT c.conname,
           c.contype::text AS contype,
           c.confdeltype::text AS confdeltype,
           pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c
    WHERE c.conrelid = ${`"${table}"`}::regclass
    ORDER BY c.conname
  `;

describe("deployed schema — tables", () => {
  it("has every application table", async () => {
    const rows = await client.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `;
    const tables = rows.map((r) => r.tablename);
    for (const table of [
      "Document",
      "Message",
      "Workspace",
      "WorkspaceMember",
      "account",
      "session",
      "user",
      "verification",
    ]) {
      expect(tables).toContain(table);
    }
  });
});

describe("deployed schema — Document columns", () => {
  it("keeps canvasData as nullable jsonb", async () => {
    const canvasData = await column("Document", "canvasData");
    expect(canvasData.udt_name).toBe("jsonb");
    expect(canvasData.is_nullable).toBe("YES");
  });

  it("keeps yjsState as nullable bytea so binary Yjs updates survive intact", async () => {
    const yjsState = await column("Document", "yjsState");
    expect(yjsState.udt_name).toBe("bytea");
    expect(yjsState.is_nullable).toBe("YES");
  });

  it("keeps initialContent as a nullable text column", async () => {
    const initialContent = await column("Document", "initialContent");
    expect(initialContent.data_type).toBe("text");
    expect(initialContent.is_nullable).toBe("YES");
  });

  it("types the document kind as the DocumentType enum, defaulting to CANVAS", async () => {
    const type = await column("Document", "type");
    expect(type.udt_name).toBe("DocumentType");
    expect(type.is_nullable).toBe("NO");

    const [row] = await client.$queryRaw<{ default: string }[]>`
      SELECT column_default AS "default" FROM information_schema.columns
      WHERE table_name = 'Document' AND column_name = 'type'
    `;
    expect(row!.default).toContain("CANVAS");
  });

  it("requires title and workspaceId", async () => {
    expect((await column("Document", "title")).is_nullable).toBe("NO");
    expect((await column("Document", "workspaceId")).is_nullable).toBe("NO");
  });
});

describe("deployed schema — Workspace columns", () => {
  it("backs slugId with a sequence-backed integer", async () => {
    const slugId = await column("Workspace", "slugId");
    expect(slugId.data_type).toBe("integer");
    expect(slugId.is_nullable).toBe("NO");

    const [row] = await client.$queryRaw<{ default: string }[]>`
      SELECT column_default AS "default" FROM information_schema.columns
      WHERE table_name = 'Workspace' AND column_name = 'slugId'
    `;
    expect(row!.default).toContain("nextval");
  });

  it("keeps description optional and name required", async () => {
    expect((await column("Workspace", "description")).is_nullable).toBe("YES");
    expect((await column("Workspace", "name")).is_nullable).toBe("NO");
  });

  it("stores timestamps without time zone, as Prisma DateTime does", async () => {
    expect((await column("Workspace", "createdAt")).data_type).toContain(
      "timestamp without time zone",
    );
  });
});

describe("deployed schema — enums", () => {
  it("declares MemberRole labels in privilege order", async () => {
    const rows = await client.$queryRaw<{ label: string }[]>`
      SELECT e.enumlabel AS label
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'MemberRole'
      ORDER BY e.enumsortorder
    `;
    expect(rows.map((r) => r.label)).toEqual(["OWNER", "ADMIN", "MEMBER"]);
  });

  it("declares DocumentType labels", async () => {
    const rows = await client.$queryRaw<{ label: string }[]>`
      SELECT e.enumlabel AS label
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'DocumentType'
      ORDER BY e.enumsortorder
    `;
    expect(rows.map((r) => r.label)).toEqual(["CANVAS", "MARKDOWN"]);
  });
});

describe("deployed schema — referential actions", () => {
  it.each([
    ["Document", "Document_workspaceId_fkey"],
    ["Message", "Message_workspaceId_fkey"],
    ["Message", "Message_userId_fkey"],
    ["WorkspaceMember", "WorkspaceMember_workspaceId_fkey"],
    ["WorkspaceMember", "WorkspaceMember_userId_fkey"],
    ["session", "session_userId_fkey"],
    ["account", "account_userId_fkey"],
  ])("%s.%s deletes children with the parent", async (table, constraint) => {
    const found = (await constraintsOf(table)).find((c) => c.conname === constraint);
    expect(found, `${constraint} is missing from ${table}`).toBeDefined();
    expect(found!.contype).toBe("f");
    expect(found!.confdeltype).toBe("c");
    expect(found!.definition).toContain("ON DELETE CASCADE");
  });
});

describe("deployed schema — unique constraints", () => {
  const uniqueIndexes = (table: string) =>
    client.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = ${table}
        AND indexdef LIKE 'CREATE UNIQUE%'
    `;

  it("enforces one membership per user and workspace", async () => {
    const defs = (await uniqueIndexes("WorkspaceMember")).map((r) => r.indexdef);
    expect(defs.some((d) => /userId.*workspaceId/.test(d))).toBe(true);
  });

  it("enforces unique Workspace.slugId and inviteCode", async () => {
    const defs = (await uniqueIndexes("Workspace")).map((r) => r.indexdef);
    expect(defs.some((d) => d.includes("slugId"))).toBe(true);
    expect(defs.some((d) => d.includes("inviteCode"))).toBe(true);
  });

  it("leaves Workspace.slug non-unique", async () => {
    const defs = (await uniqueIndexes("Workspace")).map((r) => r.indexdef);
    expect(defs.some((d) => /\(slug\)/.test(d))).toBe(false);
  });

  it("enforces unique user emails and session tokens", async () => {
    expect(
      (await uniqueIndexes("user")).some((r) => r.indexdef.includes("email")),
    ).toBe(true);
    expect(
      (await uniqueIndexes("session")).some((r) => r.indexdef.includes("token")),
    ).toBe(true);
  });
});
