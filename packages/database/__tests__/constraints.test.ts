import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client";
import {
  acquireDatabaseLock,
  capturePrismaError,
  createTestClient,
  createUser,
  createWorkspace,
  releaseDatabaseLock,
  truncateAll,
} from "./dbTestUtils";

/**
 * The write paths the application depends on, exercised against real Postgres.
 *
 * Unique constraints, foreign keys and column defaults are enforced by the
 * database, so only a real server can prove them; a mocked client would just
 * re-assert the schema file.
 */
let client: PrismaClient;

beforeAll(async () => {
  await acquireDatabaseLock();
  client = createTestClient();
}, 120_000);

beforeEach(async () => {
  await truncateAll(client);
});

afterAll(async () => {
  await client.$disconnect();
  await releaseDatabaseLock();
});

describe("workspace identity", () => {
  it("assigns an auto-incrementing slugId to each workspace", async () => {
    const first = await createWorkspace(client);
    const second = await createWorkspace(client);

    expect(first.slugId).toBeGreaterThan(0);
    expect(second.slugId).toBeGreaterThan(first.slugId);
  });

  it("generates a distinct invite code per workspace", async () => {
    const first = await createWorkspace(client);
    const second = await createWorkspace(client);
    expect(first.inviteCode).not.toBe(second.inviteCode);
  });

  it("rejects a duplicate invite code", async () => {
    await createWorkspace(client, { inviteCode: "SHARED-CODE" });
    const error = await capturePrismaError(
      () => createWorkspace(client, { inviteCode: "SHARED-CODE" }),
      "P2002",
    );
    expect(JSON.stringify(error.meta)).toContain("inviteCode");
  });

  it("rejects a duplicate slugId", async () => {
    const first = await createWorkspace(client);
    await capturePrismaError(
      () =>
        client.workspace.create({
          data: { name: "Clone", slug: "clone", slugId: first.slugId },
        }),
      "P2002",
    );
  });

  it("accepts duplicate slugs, leaving slugId as the only identifier", async () => {
    const first = await createWorkspace(client, { slug: "ada-dev" });
    const second = await createWorkspace(client, { slug: "ada-dev" });

    expect(second.slug).toBe(first.slug);
    expect(second.slugId).not.toBe(first.slugId);
  });

  it("accepts duplicate workspace names", async () => {
    const first = await createWorkspace(client, { name: "Team Rocket" });
    const second = await createWorkspace(client, { name: "Team Rocket" });
    expect(second.id).not.toBe(first.id);
  });
});

describe("user identity", () => {
  it("defaults emailVerified to false", async () => {
    const user = await createUser(client);
    expect(user.emailVerified).toBe(false);
    expect(user.image).toBeNull();
  });

  it("rejects a duplicate email", async () => {
    const user = await createUser(client);
    await capturePrismaError(
      () =>
        client.user.create({
          data: { id: "second-user", name: "Impostor", email: user.email },
        }),
      "P2002",
    );
  });

  it("rejects a second user with the same id", async () => {
    const user = await createUser(client);
    await capturePrismaError(
      () =>
        client.user.create({
          data: { id: user.id, name: "Clone", email: "clone@example.com" },
        }),
      "P2002",
    );
  });
});

describe("workspace membership", () => {
  it("defaults the role to MEMBER", async () => {
    const user = await createUser(client);
    const workspace = await createWorkspace(client);

    const member = await client.workspaceMember.create({
      data: { userId: user.id, workspaceId: workspace.id },
    });
    expect(member.role).toBe("MEMBER");
    expect(member.joinedAt).toBeInstanceOf(Date);
  });

  it("stores explicit OWNER and ADMIN roles", async () => {
    const owner = await createUser(client);
    const admin = await createUser(client);
    const workspace = await createWorkspace(client);

    const ownerRow = await client.workspaceMember.create({
      data: { userId: owner.id, workspaceId: workspace.id, role: "OWNER" },
    });
    const adminRow = await client.workspaceMember.create({
      data: { userId: admin.id, workspaceId: workspace.id, role: "ADMIN" },
    });

    expect(ownerRow.role).toBe("OWNER");
    expect(adminRow.role).toBe("ADMIN");
  });

  it("allows a user to be a member of two workspaces", async () => {
    const user = await createUser(client);
    const first = await createWorkspace(client);
    const second = await createWorkspace(client);

    await client.workspaceMember.create({
      data: { userId: user.id, workspaceId: first.id },
    });
    await client.workspaceMember.create({
      data: { userId: user.id, workspaceId: second.id },
    });

    expect(await client.workspaceMember.count({ where: { userId: user.id } })).toBe(2);
  });

  it("rejects a second membership row for the same user and workspace", async () => {
    const user = await createUser(client);
    const workspace = await createWorkspace(client);
    await client.workspaceMember.create({
      data: { userId: user.id, workspaceId: workspace.id, role: "OWNER" },
    });

    const error = await capturePrismaError(
      () =>
        client.workspaceMember.create({
          data: { userId: user.id, workspaceId: workspace.id, role: "ADMIN" },
        }),
      "P2002",
    );
    expect(JSON.stringify(error.meta)).toMatch(/userId/);
  });

  it("rejects a membership for a workspace that does not exist", async () => {
    const user = await createUser(client);
    await capturePrismaError(
      () =>
        client.workspaceMember.create({
          data: { userId: user.id, workspaceId: "workspace-that-does-not-exist" },
        }),
      "P2003",
    );
  });

  it("rejects a membership for a user that does not exist", async () => {
    const workspace = await createWorkspace(client);
    await capturePrismaError(
      () =>
        client.workspaceMember.create({
          data: { userId: "user-that-does-not-exist", workspaceId: workspace.id },
        }),
      "P2003",
    );
  });

  it("rejects a role value outside the enum", async () => {
    const user = await createUser(client);
    const workspace = await createWorkspace(client);

    await expect(
      client.$executeRawUnsafe(
        `INSERT INTO "WorkspaceMember" (id, "userId", "workspaceId", role) VALUES ($1, $2, $3, 'SUPERADMIN')`,
        "member-bad-role",
        user.id,
        workspace.id,
      ),
    ).rejects.toThrow(/SUPERADMIN|invalid input value for enum/i);
  });
});

describe("messages", () => {
  it("stamps createdAt automatically", async () => {
    const user = await createUser(client);
    const workspace = await createWorkspace(client);
    const before = Date.now();

    const message = await client.message.create({
      data: { content: "hello", userId: user.id, workspaceId: workspace.id },
    });

    expect(message.createdAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(message.createdAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("rejects a message from an author that does not exist", async () => {
    const workspace = await createWorkspace(client);
    const error = await capturePrismaError(
      () =>
        client.message.create({
          data: {
            content: "ghost",
            userId: "user-that-does-not-exist",
            workspaceId: workspace.id,
          },
        }),
      "P2003",
    );
    expect(JSON.stringify(error.meta)).toMatch(/userId/);
  });

  it("rejects a message in a workspace that does not exist", async () => {
    const user = await createUser(client);
    await capturePrismaError(
      () =>
        client.message.create({
          data: {
            content: "nowhere",
            userId: user.id,
            workspaceId: "workspace-that-does-not-exist",
          },
        }),
      "P2003",
    );
  });

  it("scopes message reads to a single workspace", async () => {
    const user = await createUser(client);
    const first = await createWorkspace(client);
    const second = await createWorkspace(client);

    await client.message.create({
      data: { content: "in first", userId: user.id, workspaceId: first.id },
    });
    await client.message.create({
      data: { content: "in second", userId: user.id, workspaceId: second.id },
    });

    const found = await client.message.findMany({
      where: { workspaceId: first.id },
      select: { content: true },
    });
    expect(found.map((m) => m.content)).toEqual(["in first"]);
  });
});

describe("documents", () => {
  it("defaults the type to CANVAS and leaves state columns empty", async () => {
    const workspace = await createWorkspace(client);
    const document = await client.document.create({
      data: { title: "Untitled", workspaceId: workspace.id },
    });

    expect(document.type).toBe("CANVAS");
    expect(document.canvasData).toBeNull();
    expect(document.yjsState).toBeNull();
    expect(document.initialContent).toBeNull();
  });

  it("stores MARKDOWN documents separately from CANVAS ones", async () => {
    const workspace = await createWorkspace(client);
    const markdown = await client.document.create({
      data: { title: "Notes", workspaceId: workspace.id, type: "MARKDOWN" },
    });
    expect(markdown.type).toBe("MARKDOWN");
    expect(
      await client.document.count({ where: { workspaceId: workspace.id, type: "CANVAS" } }),
    ).toBe(0);
  });

  it("rejects a document in a workspace that does not exist", async () => {
    await capturePrismaError(
      () =>
        client.document.create({
          data: { title: "Orphan", workspaceId: "workspace-that-does-not-exist" },
        }),
      "P2003",
    );
  });

  it("bumps updatedAt on write but keeps createdAt fixed", async () => {
    const workspace = await createWorkspace(client);
    const created = await client.document.create({
      data: { title: "Draft", workspaceId: workspace.id },
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    const updated = await client.document.update({
      where: { id: created.id },
      data: { title: "Renamed" },
    });

    expect(updated.createdAt.getTime()).toBe(created.createdAt.getTime());
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(
      created.updatedAt.getTime(),
    );
  });
});

describe("collaborative state round-trips", () => {
  it("returns Yjs binary state byte-for-byte", async () => {
    const workspace = await createWorkspace(client);
    // Includes a NUL byte and invalid UTF-8, so a text column would mangle it.
    const state = Buffer.from([0, 1, 255, 254, 10, 13, 0, 130, 7]);

    const document = await client.document.create({
      data: { title: "Doc", workspaceId: workspace.id, type: "MARKDOWN", yjsState: state },
    });

    const reloaded = await client.document.findUniqueOrThrow({
      where: { id: document.id },
    });
    expect(reloaded.yjsState).toBeInstanceOf(Uint8Array);
    expect(Buffer.compare(Buffer.from(reloaded.yjsState!), state)).toBe(0);
    expect(reloaded.yjsState).toHaveLength(state.length);
  });

  it("clears yjsState back to NULL", async () => {
    const workspace = await createWorkspace(client);
    const document = await client.document.create({
      data: {
        title: "Doc",
        workspaceId: workspace.id,
        yjsState: Buffer.from([1, 2, 3]),
      },
    });

    const cleared = await client.document.update({
      where: { id: document.id },
      data: { yjsState: null },
    });
    expect(cleared.yjsState).toBeNull();
  });

  it("round-trips an Excalidraw element array through the Json column", async () => {
    const workspace = await createWorkspace(client);
    const elements = [
      { id: "el-1", type: "rectangle", x: 0, y: 0, width: 100, height: 50, seed: 42 },
      { id: "el-2", type: "text", text: "héllo \"world\"\n", points: [[0, 0], [1, 1]] },
    ];

    const document = await client.document.create({
      data: { title: "Board", workspaceId: workspace.id, canvasData: elements },
    });

    const reloaded = await client.document.findUniqueOrThrow({
      where: { id: document.id },
    });
    expect(reloaded.canvasData).toEqual(elements);
  });

  it("accepts an empty element array as a real value, distinct from NULL", async () => {
    const workspace = await createWorkspace(client);
    const cleared = await client.document.create({
      data: { title: "Cleared", workspaceId: workspace.id, canvasData: [] },
    });

    const reloaded = await client.document.findUniqueOrThrow({
      where: { id: cleared.id },
    });
    expect(reloaded.canvasData).toEqual([]);
    expect(reloaded.canvasData).not.toBeNull();
  });

  it("replaces the whole canvas state on update (last write wins)", async () => {
    const workspace = await createWorkspace(client);
    const document = await client.document.create({
      data: {
        title: "Board",
        workspaceId: workspace.id,
        canvasData: [{ id: "a" }, { id: "b" }],
      },
    });

    const updated = await client.document.update({
      where: { id: document.id },
      data: { canvasData: [{ id: "c" }] },
    });
    expect(updated.canvasData).toEqual([{ id: "c" }]);
  });

  it("keeps the AI seed available until it is consumed", async () => {
    const workspace = await createWorkspace(client);
    const seeded = await client.document.create({
      data: {
        title: "AI Notes",
        workspaceId: workspace.id,
        type: "MARKDOWN",
        initialContent: "# Generated\n\nBody",
      },
    });
    expect(seeded.initialContent).toBe("# Generated\n\nBody");

    // Consumption is a plain null write, so rejoiners must read Yjs state instead.
    const consumed = await client.document.update({
      where: { id: seeded.id },
      data: { initialContent: null },
    });
    expect(consumed.initialContent).toBeNull();
  });
});
