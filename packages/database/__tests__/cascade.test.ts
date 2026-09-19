import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client";
import {
  acquireDatabaseLock,
  createTestClient,
  createUser,
  createWorkspace,
  releaseDatabaseLock,
  truncateAll,
} from "./dbTestUtils";

/**
 * Cascade behaviour, verified through the database rather than the schema text.
 *
 * Deleting a workspace or a user must not leave orphaned rows behind: the
 * application never cleans these up itself, it relies on `ON DELETE CASCADE`.
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

/** Creates a workspace with one owner, one document of each kind and a message. */
async function seedWorkspace() {
  const owner = await createUser(client, { name: "Owner" });
  const workspace = await createWorkspace(client);

  await client.workspaceMember.create({
    data: { userId: owner.id, workspaceId: workspace.id, role: "OWNER" },
  });
  await client.document.create({
    data: {
      title: "Board",
      workspaceId: workspace.id,
      type: "CANVAS",
      canvasData: [{ id: "el-1" }],
    },
  });
  await client.document.create({
    data: {
      title: "Notes",
      workspaceId: workspace.id,
      type: "MARKDOWN",
      yjsState: Buffer.from([1, 2, 3]),
      initialContent: "# seed",
    },
  });
  await client.message.create({
    data: { content: "hello", userId: owner.id, workspaceId: workspace.id },
  });

  return { owner, workspace };
}

describe("deleting a workspace", () => {
  it("removes its documents, messages and memberships", async () => {
    const { owner, workspace } = await seedWorkspace();

    await client.workspace.delete({ where: { id: workspace.id } });

    expect(await client.document.count({ where: { workspaceId: workspace.id } })).toBe(0);
    expect(await client.message.count({ where: { workspaceId: workspace.id } })).toBe(0);
    expect(
      await client.workspaceMember.count({ where: { workspaceId: workspace.id } }),
    ).toBe(0);

    // The people survive; only their link to the workspace is gone.
    expect(await client.user.findUnique({ where: { id: owner.id } })).not.toBeNull();
  });

  it("leaves other workspaces untouched", async () => {
    const { workspace } = await seedWorkspace();
    const survivor = await seedWorkspace();

    await client.workspace.delete({ where: { id: workspace.id } });

    expect(await client.document.count({ where: { workspaceId: survivor.workspace.id } })).toBe(2);
    expect(await client.message.count({ where: { workspaceId: survivor.workspace.id } })).toBe(1);
  });

  it("leaves no orphaned rows anywhere in the schema", async () => {
    const { workspace } = await seedWorkspace();
    await client.workspace.delete({ where: { id: workspace.id } });

    const [documents, messages, members] = await Promise.all([
      client.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) AS count FROM "Document"
        WHERE "workspaceId" NOT IN (SELECT id FROM "Workspace")
      `,
      client.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) AS count FROM "Message"
        WHERE "workspaceId" NOT IN (SELECT id FROM "Workspace")
      `,
      client.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) AS count FROM "WorkspaceMember"
        WHERE "workspaceId" NOT IN (SELECT id FROM "Workspace")
      `,
    ]);

    expect(Number(documents[0]!.count)).toBe(0);
    expect(Number(messages[0]!.count)).toBe(0);
    expect(Number(members[0]!.count)).toBe(0);
  });
});

describe("deleting a user", () => {
  it("removes their messages and memberships", async () => {
    const { owner, workspace } = await seedWorkspace();

    await client.user.delete({ where: { id: owner.id } });

    expect(await client.message.count({ where: { userId: owner.id } })).toBe(0);
    expect(await client.workspaceMember.count({ where: { userId: owner.id } })).toBe(0);
    expect(await client.workspace.findUnique({ where: { id: workspace.id } })).not.toBeNull();
  });

  it("removes their sessions and linked accounts", async () => {
    const user = await createUser(client);
    await client.session.create({
      data: {
        id: "session-1",
        token: "token-1",
        userId: user.id,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await client.account.create({
      data: { id: "account-1", accountId: "google-1", providerId: "google", userId: user.id },
    });

    await client.user.delete({ where: { id: user.id } });

    expect(await client.session.count({ where: { userId: user.id } })).toBe(0);
    expect(await client.account.count({ where: { userId: user.id } })).toBe(0);
  });

  it("keeps the documents and messages of the remaining members", async () => {
    const { workspace } = await seedWorkspace();
    const second = await createUser(client, { name: "Second" });
    await client.message.create({
      data: { content: "still here", userId: second.id, workspaceId: workspace.id },
    });

    await client.user.delete({ where: { id: second.id } });

    expect(await client.message.count({ where: { workspaceId: workspace.id } })).toBe(1);
    expect(await client.document.count({ where: { workspaceId: workspace.id } })).toBe(2);
  });
});

describe("deleting a document", () => {
  it("does not disturb the workspace or its other documents", async () => {
    const { workspace } = await seedWorkspace();
    const [first] = await client.document.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { title: "asc" },
    });

    await client.document.delete({ where: { id: first!.id } });

    expect(await client.document.count({ where: { workspaceId: workspace.id } })).toBe(1);
    expect(await client.workspace.findUnique({ where: { id: workspace.id } })).not.toBeNull();
  });
});
