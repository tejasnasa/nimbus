/**
 * @module testhelpers/factories
 * @description Direct-to-database fixture builders for workspaces, membership,
 * documents, and messages.
 *
 * These bypass the REST/socket layers on purpose: tests that exercise an
 * endpoint shouldn't depend on other endpoints to arrange their preconditions,
 * or a failure in one masks the failure in the other. Flow-level correctness is
 * covered separately by the HTTP and socket suites.
 */
import { randomUUID } from "node:crypto";
import { testPrisma } from "./database";

/** Roles the schema allows, mirroring `MemberRole`. */
export type TestRole = "OWNER" | "ADMIN" | "MEMBER";

/**
 * Creates a verified user row directly.
 *
 * For suites that need authored rows (message history, membership) but not an
 * authenticated session — use `mintUser` when a session is actually required.
 *
 * @param name - Display name, also used to make the email unique-readable.
 */
export const createUser = async (name = "Test User") => {
  const id = `user-${randomUUID()}`;

  return testPrisma.user.create({
    data: { id, name, email: `${id}@example.test`, emailVerified: true },
  });
};

/**
 * Creates a workspace with the given user as OWNER.
 *
 * @param ownerId - User who becomes the sole OWNER.
 * @param name - Display name (schema only requires a non-empty string).
 */
export const createWorkspace = async (ownerId: string, name = "Test Workspace") =>
  testPrisma.workspace.create({
    data: {
      name,
      slug: `test-ws-${randomUUID().slice(0, 8)}`,
      description: "Workspace created by the test suite",
      members: { create: [{ userId: ownerId, role: "OWNER" }] },
    },
  });

/**
 * Adds a user to a workspace with the given role.
 *
 * @param workspaceId - Target workspace.
 * @param userId - User to add.
 * @param role - Membership role (defaults to MEMBER).
 */
export const addMember = async (
  workspaceId: string,
  userId: string,
  role: TestRole = "MEMBER",
) =>
  testPrisma.workspaceMember.create({
    data: { workspaceId, userId, role },
  });

/**
 * Creates a document inside a workspace.
 *
 * @param workspaceId - Owning workspace.
 * @param overrides - Optional title/type/canvasData/initialContent.
 */
export const createDocument = async (
  workspaceId: string,
  overrides: {
    title?: string;
    type?: "CANVAS" | "MARKDOWN";
    initialContent?: string | null;
  } = {},
) =>
  testPrisma.document.create({
    data: {
      title: overrides.title ?? "Test Document",
      type: overrides.type ?? "CANVAS",
      workspaceId,
      canvasData: [],
      initialContent: overrides.initialContent ?? null,
    },
  });

/**
 * Creates a chat message in a workspace.
 *
 * @param workspaceId - Target workspace.
 * @param userId - Author (may be the bot's user id).
 * @param content - Message body.
 */
export const createMessage = async (
  workspaceId: string,
  userId: string,
  content = "Test message",
) =>
  testPrisma.message.create({
    data: { workspaceId, userId, content },
  });
