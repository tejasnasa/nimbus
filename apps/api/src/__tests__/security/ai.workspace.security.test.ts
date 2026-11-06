/**
 * @module api/__tests__/security/ai.workspace
 * @description The security properties of the workspace AI surface: no secret
 * ever leaves the server, a member cannot read what only admins may, and one
 * workspace's keys and call log are unreachable from another.
 *
 * @important The sweep at the end walks every readable route as every role and
 *            asserts no response contains a key, an envelope, a key id or a
 *            fingerprint. A new field that leaks one fails here.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import {
  TEST_AI_KEY,
  addMember,
  as,
  closeTestResources,
  createWorkspace,
  createWorkspaceAiCredential,
  mintUser,
  resetDatabase,
  testPrisma,
  type TestUser,
} from "@testhelpers";

vi.mock("../../lib/ai/probe", async () => {
  const actual = await vi.importActual<typeof import("../../lib/ai/probe")>(
    "../../lib/ai/probe",
  );
  return {
    ...actual,
    probeCredential: vi.fn(async () => ({
      ok: true as const,
      verifiedKinds: ["text" as const],
      warnings: [],
    })),
  };
});

const app = createApp();

let owner: TestUser;
let admin: TestUser;
let member: TestUser;
let outsider: TestUser;
let workspaceId: string;
let otherWorkspaceId: string;
let credentialFingerprint: string;
let credentialKeyId: string;
let credentialEnvelope: string;

beforeAll(async () => {
  await resetDatabase();
  owner = await mintUser(app);
  admin = await mintUser(app);
  member = await mintUser(app);
  outsider = await mintUser(app);
});

beforeEach(async () => {
  await testPrisma.workspace.deleteMany({});
  workspaceId = (await createWorkspace(owner.id)).id;
  await addMember(workspaceId, admin.id, "ADMIN");
  await addMember(workspaceId, member.id, "MEMBER");
  otherWorkspaceId = (await createWorkspace(outsider.id)).id;

  const row = await createWorkspaceAiCredential(workspaceId, "openai", {
    createdById: admin.id,
  });
  credentialFingerprint = row.keyFingerprint;
  credentialKeyId = row.keyId;
  credentialEnvelope = row.keyEnvelope;
  await testPrisma.aiCall.create({
    data: {
      workspaceId,
      userId: member.id,
      feature: "CHAT",
      providerId: "openai",
      modelId: "gpt-5-nano",
      source: "BYOK",
      status: "OK",
      latencyMs: 10,
      costUsd: 0.01,
    },
  });
});

afterAll(async () => {
  await closeTestResources();
});

const ws = (id = workspaceId) => `/api/ai/workspaces/${id}`;

describe("members cannot read admin-only data", () => {
  it("is refused the credential list", async () => {
    const res = await as(app, member).get(`${ws()}/credentials`);
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain("openai");
  });

  it("is refused the call log", async () => {
    const res = await as(app, member).get(`${ws()}/usage`);
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain("gpt-5-nano");
  });

  it("is refused every write", async () => {
    const attempts = [
      as(app, member).post(`${ws()}/credentials`).send({ providerId: "openai", apiKey: "sk-x" }),
      as(app, member).delete(`${ws()}/credentials/openai`),
      as(app, member).put(`${ws()}/settings`).send({ assistantEnabled: false }),
      as(app, member).put(`${ws()}/preferences`).send({ feature: "chat", providerId: "openai", modelId: "gpt-5-nano" }),
    ];
    for (const res of await Promise.all(attempts)) expect(res.status).toBe(403);
    expect(await testPrisma.workspaceAiCredential.count({ where: { workspaceId } })).toBe(1);
  });
});

describe("workspaces are isolated", () => {
  it("answers a non-member with 404 on every route, so existence is not confirmed", async () => {
    const calls = [
      as(app, outsider).get(`${ws()}/status`),
      as(app, outsider).get(`${ws()}/credentials`),
      as(app, outsider).get(`${ws()}/preferences`),
      as(app, outsider).get(`${ws()}/settings`),
      as(app, outsider).get(`${ws()}/usage`),
      as(app, outsider).delete(`${ws()}/credentials/openai`),
    ];
    for (const res of await Promise.all(calls)) expect(res.status).toBe(404);
  });

  it("does not let an admin of one workspace act on another", async () => {
    const res = await as(app, admin).delete(`${ws(otherWorkspaceId)}/credentials/openai`);
    expect(res.status).toBe(404);
    const save = await as(app, admin)
      .post(`${ws(otherWorkspaceId)}/credentials`)
      .send({ providerId: "openai", apiKey: TEST_AI_KEY });
    expect(save.status).toBe(404);
    expect(await testPrisma.workspaceAiCredential.count({ where: { workspaceId: otherWorkspaceId } })).toBe(0);
  });

  it("treats an unknown workspace id exactly like one the caller is not in", async () => {
    const unknown = await as(app, admin).get(`${ws("does-not-exist")}/status`);
    const foreign = await as(app, admin).get(`${ws(otherWorkspaceId)}/status`);
    expect(unknown.status).toBe(404);
    expect(foreign.status).toBe(404);
    expect(foreign.body.message).toBe(unknown.body.message);
  });

  it("requires a session for every route", async () => {
    for (const path of ["status", "credentials", "preferences", "settings", "usage"]) {
      const res = await request(app).get(`${ws()}/${path}`);
      expect(res.status).toBe(401);
    }
    expect((await request(app).get("/api/ai/me/free-usage")).status).toBe(401);
  });

  it("cannot be re-pointed to a workspace through the request body", async () => {
    const res = await as(app, admin)
      .post(`${ws()}/credentials`)
      .send({ providerId: "groq", apiKey: TEST_AI_KEY, workspaceId: otherWorkspaceId });
    expect(res.status).toBe(201);
    expect(await testPrisma.workspaceAiCredential.count({ where: { workspaceId: otherWorkspaceId } })).toBe(0);
    expect(await testPrisma.workspaceAiCredential.count({ where: { workspaceId, providerId: "groq" } })).toBe(1);
  });
});

describe("no secret leaves the server", () => {
  it("never returns a key, envelope, key id or fingerprint from any readable route", async () => {
    await testPrisma.workspaceAiPreference.create({
      data: { workspaceId, feature: "CHAT", providerId: "openai", modelId: "gpt-5-nano" },
    });
    const forbidden = [
      TEST_AI_KEY,
      TEST_AI_KEY.slice(-12),
      credentialEnvelope,
      credentialKeyId,
      credentialFingerprint,
      "keyEnvelope",
      "keyFingerprint",
      "nimbus1.",
    ];
    const paths = ["status", "credentials", "preferences", "settings", "usage"];
    for (const user of [owner, admin, member]) {
      for (const path of paths) {
        const res = await as(app, user).get(`${ws()}/${path}`);
        const text = JSON.stringify(res.body);
        for (const secret of forbidden) {
          expect(text, `${path} as ${user.id}`).not.toContain(secret);
        }
      }
      const free = await as(app, user).get("/api/ai/me/free-usage");
      for (const secret of forbidden) {
        expect(JSON.stringify(free.body)).not.toContain(secret);
      }
    }
  });

  it("returns only the masked preview when a credential is saved", async () => {
    const res = await as(app, admin)
      .post(`${ws()}/credentials`)
      .send({ providerId: "deepseek", apiKey: "sk-test-fake-other-key-ZZZZ9999" });
    expect(res.status).toBe(201);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain("sk-test-fake-other-key-ZZZZ9999");
    expect(text).not.toContain("keyEnvelope");
    expect(res.body.responseObject.maskedPreview).toBeTruthy();
  });

  it("does not echo a rejected key back in the error", async () => {
    const probeModule = await import("../../lib/ai/probe");
    vi.mocked(probeModule.probeCredential).mockResolvedValueOnce({
      ok: false,
      reason: "incorrect-key",
      message: "Incorrect API key.",
    });
    const res = await as(app, admin)
      .post(`${ws()}/credentials`)
      .send({ providerId: "openai", apiKey: "sk-test-fake-rejected-QQQQ8888" });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain("QQQQ8888");
  });
});

describe("stored envelopes are bound to their workspace", () => {
  it("fails closed when a row is copied into another workspace", async () => {
    const { decryptSecret, buildAad } = await import("../../lib/ai/credentialCrypto");
    expect(() =>
      decryptSecret(
        credentialEnvelope,
        buildAad({ kind: "workspace", workspaceId: otherWorkspaceId }, "openai"),
      ),
    ).toThrow();
  });
});
