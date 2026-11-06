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
import { buildAad, encryptSecret } from "../src/lib/ai/credentialCrypto";
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

/** The throwaway key tests store. Distinctive, so a leak is easy to grep for. */
export const TEST_AI_KEY = "sk-test-fake-key-DISTINCT12345678";

/**
 * Stores an encrypted AI credential for a workspace, as the save route would.
 *
 * @param workspaceId - Owning workspace.
 * @param providerId - Registry provider id.
 * @param overrides - Optional plaintext key, verified kinds, creation time and creator.
 */
export const createWorkspaceAiCredential = async (
  workspaceId: string,
  providerId: string,
  overrides: {
    apiKey?: string;
    verifiedKinds?: string[];
    createdAt?: Date;
    createdById?: string | null;
    label?: string;
  } = {},
) => {
  const apiKey = overrides.apiKey ?? TEST_AI_KEY;
  const keyEnvelope = encryptSecret(
    apiKey,
    buildAad({ kind: "workspace", workspaceId }, providerId),
  );
  return testPrisma.workspaceAiCredential.create({
    data: {
      workspaceId,
      providerId,
      label: overrides.label ?? null,
      keyEnvelope,
      keyId: keyEnvelope.split(".")[1] ?? "",
      keyFingerprint: `fp${randomUUID().slice(0, 12)}`,
      maskedPreview: "sk-…5678",
      verifiedKinds: overrides.verifiedKinds ?? ["text"],
      validatedAt: new Date(),
      createdById: overrides.createdById ?? null,
      ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
    },
  });
};

/**
 * Stores a workspace AI preference row directly.
 *
 * @param workspaceId - Owning workspace.
 * @param feature - Upper-case `AiFeature` enum value.
 * @param providerId - Provider the preference names.
 * @param modelId - Model the preference names.
 * @param extra - Optional model source, stored capabilities and voice.
 */
export const createWorkspaceAiPreference = async (
  workspaceId: string,
  feature:
    | "CHAT"
    | "MARKDOWN"
    | "CANVAS"
    | "VISION"
    | "TRANSCRIPTION"
    | "SPEECH"
    | "MEETING",
  providerId: string,
  modelId: string,
  extra: {
    modelSource?: string;
    modelCapabilities?: string[];
    voice?: string | null;
  } = {},
) =>
  testPrisma.workspaceAiPreference.create({
    data: {
      workspaceId,
      feature,
      providerId,
      modelId,
      modelSource: extra.modelSource ?? "registry",
      modelCapabilities: extra.modelCapabilities ?? [],
      voice: extra.voice ?? null,
    },
  });
