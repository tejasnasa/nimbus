import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DocumentType, MemberRole } from "../src/generated/prisma/enums";

/**
 * Drift guard for `prisma/schema.prisma`.
 *
 * These assertions pin the schema text itself rather than the database: the
 * deployed database is verified separately, by the suites that talk to it.
 * Every expectation here encodes something the application relies on, so a
 * change to it should fail loudly instead of silently changing behaviour.
 */
const schemaPath = fileURLToPath(new URL("../prisma/schema.prisma", import.meta.url));
const schema = readFileSync(schemaPath, "utf8");

/** Returns the body of a `model`/`enum` block, without its braces. */
function block(kind: "model" | "enum", name: string): string {
  const match = schema.match(
    new RegExp(`(?:^|\\n)\\s*${kind}\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\}`),
  );
  if (!match) throw new Error(`No ${kind} named ${name} in schema.prisma`);
  return match[1]!;
}

/** The declarations inside a block, with doc comments and blanks removed. */
function declarations(kind: "model" | "enum", name: string): string[] {
  return block(kind, name)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("//"));
}

/** A single field declaration, deconstructed. */
function field(model: string, name: string) {
  const line = declarations("model", model).find((l) => l.startsWith(`${name} `));
  if (!line) throw new Error(`No field ${model}.${name}`);
  const [, , type, array, optional] = line.match(
    /^(\S+)\s+(\S+?)(\[\])?(\?)?(\s|$)/,
  ) as RegExpMatchArray;
  return {
    line,
    type: type!,
    optional: optional === "?" || array === "[]",
    attributes: line.slice(line.indexOf(type!) + type!.length + (array ?? "").length + (optional ?? "").length).trim(),
  };
}

const MODELS = [
  "User",
  "Session",
  "Account",
  "Verification",
  "Workspace",
  "WorkspaceMember",
  "Message",
  "Document",
] as const;

describe("schema.prisma — datasource and generator", () => {
  it("targets the postgresql provider", () => {
    expect(schema).toMatch(/datasource\s+db\s*\{[^}]*provider\s*=\s*"postgresql"/);
  });

  it("generates the client the package imports from", () => {
    expect(schema).toMatch(/generator\s+client\s*\{[^}]*output\s*=\s*"\.\.\/src\/generated\/prisma"/);
  });
});

describe("schema.prisma — models", () => {
  it("declares exactly the application models", () => {
    const declared = [...schema.matchAll(/(?:^|\n)model\s+(\w+)\s*\{/g)].map(
      (m) => m[1],
    );
    expect(declared.sort()).toEqual([...MODELS].sort());
  });

  it.each(MODELS)("%s maps to a table the app queries", (model) => {
    expect(() => declarations("model", model)).not.toThrow();
  });

  it("maps the better-auth models to their lowercase tables", () => {
    for (const [model, table] of [
      ["User", "user"],
      ["Session", "session"],
      ["Account", "account"],
      ["Verification", "verification"],
    ] as const) {
      expect(declarations("model", model).join("\n")).toContain(`@@map("${table}")`);
    }
  });
});

describe("schema.prisma — enums", () => {
  it("defines MemberRole as exactly OWNER, ADMIN, MEMBER in descending privilege", () => {
    expect(declarations("enum", "MemberRole")).toEqual(["OWNER", "ADMIN", "MEMBER"]);
  });

  it("defines DocumentType as exactly CANVAS and MARKDOWN", () => {
    expect(declarations("enum", "DocumentType")).toEqual(["CANVAS", "MARKDOWN"]);
  });

  it("does not declare a second, conflicting role enum", () => {
    const enums = [...schema.matchAll(/(?:^|\n)enum\s+(\w+)\s*\{/g)].map((m) => m[1]);
    expect(enums.sort()).toEqual(["DocumentType", "MemberRole"]);
  });

  it("has a generated client that matches the schema enums", () => {
    expect(Object.keys(MemberRole).sort()).toEqual(["ADMIN", "MEMBER", "OWNER"]);
    expect(Object.keys(DocumentType).sort()).toEqual(["CANVAS", "MARKDOWN"]);
    expect(new Set(Object.values(MemberRole))).toEqual(
      new Set(declarations("enum", "MemberRole")),
    );
  });
});

describe("schema.prisma — Workspace", () => {
  it("routes by a unique auto-increment slugId, not the cuid", () => {
    const slugId = field("Workspace", "slugId");
    expect(slugId.type).toBe("Int");
    expect(slugId.attributes).toContain("@unique");
    expect(slugId.attributes).toContain("@default(autoincrement())");

    expect(field("Workspace", "id").attributes).toContain("@default(cuid())");
  });

  it("requires a unique invite code", () => {
    const inviteCode = field("Workspace", "inviteCode");
    expect(inviteCode.type).toBe("String");
    expect(inviteCode.optional).toBe(false);
    expect(inviteCode.attributes).toContain("@unique");
  });

  it("keeps slug non-unique — only slugId disambiguates", () => {
    const slug = field("Workspace", "slug");
    expect(slug.type).toBe("String");
    expect(slug.attributes).not.toContain("@unique");
  });

  it("requires a name and allows an optional description", () => {
    expect(field("Workspace", "name").optional).toBe(false);
    expect(field("Workspace", "description").optional).toBe(true);
  });
});

describe("schema.prisma — Document", () => {
  it("stores canvas state as Json and Yjs state as Bytes", () => {
    expect(field("Document", "canvasData").type).toBe("Json");
    expect(field("Document", "yjsState").type).toBe("Bytes");
  });

  it("leaves both collaborative state columns nullable", () => {
    expect(field("Document", "canvasData").optional).toBe(true);
    expect(field("Document", "yjsState").optional).toBe(true);
  });

  it("keeps initialContent nullable so the one-shot seed can be cleared", () => {
    const initialContent = field("Document", "initialContent");
    expect(initialContent.type).toBe("String");
    expect(initialContent.optional).toBe(true);
  });

  it("defaults new documents to CANVAS", () => {
    const type = field("Document", "type");
    expect(type.type).toBe("DocumentType");
    expect(type.attributes).toContain("@default(CANVAS)");
  });

  it("requires a title and a workspace", () => {
    expect(field("Document", "title").optional).toBe(false);
    expect(field("Document", "workspaceId").optional).toBe(false);
  });
});

describe("schema.prisma — WorkspaceMember", () => {
  it("enforces one membership row per user and workspace", () => {
    const body = declarations("model", "WorkspaceMember").join("\n");
    expect(body).toContain("@@unique([userId, workspaceId])");
  });

  it("defaults the role to MEMBER", () => {
    const role = field("WorkspaceMember", "role");
    expect(role.type).toBe("MemberRole");
    expect(role.attributes).toContain("@default(MEMBER)");
  });

  it("indexes both foreign keys for membership lookups", () => {
    const body = declarations("model", "WorkspaceMember").join("\n");
    expect(body).toContain("@@index([userId])");
    expect(body).toContain("@@index([workspaceId])");
  });
});

describe("schema.prisma — User, Message and relations", () => {
  it("requires a unique email", () => {
    // Declared at model level, so it covers the column rather than the field.
    expect(declarations("model", "User").join("\n")).toContain("@@unique([email])");
    expect(field("User", "email").optional).toBe(false);
    expect(field("User", "emailVerified").attributes).toContain("@default(false)");
  });

  it("requires message content, author and workspace", () => {
    for (const name of ["content", "userId", "workspaceId"]) {
      expect(field("Message", name).optional).toBe(false);
    }
  });

  it.each([
    ["Session", "userId"],
    ["Account", "userId"],
    ["WorkspaceMember", "userId"],
    ["WorkspaceMember", "workspaceId"],
    ["Message", "userId"],
    ["Message", "workspaceId"],
    ["Document", "workspaceId"],
  ] as const)("%s.%s cascades on delete", (model, name) => {
    const relation = declarations("model", model).find((line) =>
      line.includes(`fields: [${name}]`),
    );
    expect(relation, `no relation declared over ${model}.${name}`).toBeDefined();
    expect(relation).toContain("onDelete: Cascade");
  });
});
