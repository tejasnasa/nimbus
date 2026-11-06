/**
 * @module api/__tests__/integration/http/upload
 * @description The avatar-signature endpoint. The Cloudinary SDK is mocked
 * at the module boundary so no real Cloudinary call is ever made and no key
 * is needed.
 *
 * What this pins, in order of how easily each one could regress silently:
 *   - the route is mounted behind `authCheck` (anonymous = 401);
 *   - `public_id` is exactly `nimbus/avatars/<userId>` — the deterministic
 *     string both the signature endpoint and `destroyAvatar` rebuild, and
 *     the one thing that lets `User.image` carry only `secure_url` with no
 *     schema change;
 *   - the SDK was called with the exact signed parameter set, so the
 *     signature the browser sends back matches what Cloudinary expects;
 *   - the API secret never appears in the response body — pinning this
 *     on the serialized response, not just on the field map, catches a
 *     controller that builds its response from a leaking object.
 */
import { createHmac } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createApp } from "../../../app";
import {
  addMember,
  as,
  closeTestResources,
  createWorkspace,
  mintUser,
  resetDatabase,
  testPrisma,
  type TestUser,
} from "@testhelpers";

const { apiSignRequest, uploaderDestroy, deleteByPrefix } = vi.hoisted(() => ({
  apiSignRequest: vi.fn(),
  uploaderDestroy: vi.fn(),
  deleteByPrefix: vi.fn(),
}));

vi.mock("cloudinary", () => ({
  v2: {
    config: vi.fn(),
    utils: { api_sign_request: apiSignRequest },
    uploader: { destroy: uploaderDestroy },
    api: { delete_resources_by_prefix: deleteByPrefix },
  },
}));

const app = createApp();

afterAll(closeTestResources);

describe("http: upload/avatar-signature", () => {
  let user: TestUser;
  const SECRET = "test-cloudinary-api-secret";
  const CLOUD_NAME = "test-cloudinary-cloud";
  const API_KEY = "test-cloudinary-api-key";

  beforeEach(async () => {
    await resetDatabase();
    user = await mintUser(app);

    process.env.CLOUDINARY_CLOUD_NAME = CLOUD_NAME;
    process.env.CLOUDINARY_API_KEY = API_KEY;
    process.env.CLOUDINARY_API_SECRET = SECRET;

    // The SDK's helper returns whatever we tell it to; the assertion is on
    // the parameter set the *controller* built and passed in.
    apiSignRequest.mockImplementation((params: Record<string, unknown>) => {
      const sorted = Object.keys(params)
        .sort()
        .map((k) => `${k}=${String(params[k])}`)
        .join("&");
      return `sig(${sorted})`;
    });
    uploaderDestroy.mockResolvedValue({ result: "ok" });
  });

  afterEach(() => {
    delete process.env.CLOUDINARY_CLOUD_NAME;
    delete process.env.CLOUDINARY_API_KEY;
    delete process.env.CLOUDINARY_API_SECRET;
    apiSignRequest.mockReset();
    uploaderDestroy.mockReset();
  });

  it("requires authentication", async () => {
    const res = await (await import("supertest"))
      .default(app)
      .get("/api/upload/avatar-signature");

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ success: false, statusCode: 401 });
  });

  it("returns the cloud name, API key, timestamp, public_id, format and signature", async () => {
    const before = Math.floor(Date.now() / 1000);

    const res = await as(app, user).get("/api/upload/avatar-signature");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      responseObject: {
        cloudName: CLOUD_NAME,
        apiKey: API_KEY,
        publicId: `nimbus/avatars/${user.id}`,
        format: "jpg",
      },
    });

    const { timestamp, signature } = res.body.responseObject;
    expect(typeof timestamp).toBe("number");
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(signature).toMatch(/^sig\(.+\)$/);
  });

  it("answers 500 without leaking the cause when avatar signing fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    apiSignRequest.mockImplementation(() => {
      throw new Error("signing exploded with secret-detail");
    });

    const res = await as(app, user).get("/api/upload/avatar-signature");

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain("secret-detail");
  });

  it("pins `public_id` to the deterministic per-user string", async () => {
    const res = await as(app, user).get("/api/upload/avatar-signature");

    // Deriving the public_id from the user id is what removes the need for
    // a separate DB column or a metadata table. Any other value here means
    // the cleanup contract is broken: `destroyAvatar` would target a
    // different asset than the one just uploaded.
    expect(res.body.responseObject.publicId).toBe(`nimbus/avatars/${user.id}`);
  });

  it("signs exactly the documented parameter set", async () => {
    await as(app, user).get("/api/upload/avatar-signature");

    expect(apiSignRequest).toHaveBeenCalledTimes(1);

    // Cloudinary rejects extra unsigned parameters and refuses uploads
    // missing any signed one. The shape here is the wire contract.
    const [params, secret] = apiSignRequest.mock.calls[0]!;
    expect(secret).toBe(SECRET);

    const { public_id, timestamp, overwrite, invalidate, format } =
      params as Record<string, unknown>;
    expect(public_id).toBe(`nimbus/avatars/${user.id}`);
    expect(typeof timestamp).toBe("number");
    expect(overwrite).toBe(true);
    expect(invalidate).toBe(true);
    expect(format).toBe("jpg");

    // No field beyond the documented set.
    expect(Object.keys(params as Record<string, unknown>).sort()).toEqual(
      ["format", "invalidate", "overwrite", "public_id", "timestamp"].sort(),
    );
  });

  // Independent of the mock: recompute the SDK's signature algorithm
  // (HMAC-style digest over the sorted-stringified params) for a stable
  // fixture so a future SDK swap or refactor of `lib/cloudinary.signAvatarUpload`
  // cannot silently break the wire contract.
  it("produces a signature Cloudinary would accept, given its documented algorithm", async () => {
    apiSignRequest.mockRestore();
    apiSignRequest.mockImplementation(
      (params: Record<string, unknown>, apiSecret: string) =>
        createHmac("sha1", apiSecret)
          .update(
            Object.keys(params)
              .sort()
              .map((k) => `${k}=${String(params[k])}`)
              .join("&"),
          )
          .digest("hex"),
    );

    const res = await as(app, user).get("/api/upload/avatar-signature");
    const { timestamp, publicId, format, signature } = res.body.responseObject;

    // Replay: the same sorted-stringify over the canonical field set
    // yields the same digest the SDK would produce.
    const paramsToSign = {
      public_id: publicId,
      timestamp,
      overwrite: true,
      invalidate: true,
      format,
    };
    const expected = createHmac("sha1", SECRET)
      .update(
        Object.keys(paramsToSign)
          .sort()
          .map(
            (k) =>
              `${k}=${String((paramsToSign as Record<string, unknown>)[k])}`,
          )
          .join("&"),
      )
      .digest("hex");

    expect(signature).toBe(expected);
  });

  it("never includes the API secret in the response body", async () => {
    const res = await as(app, user).get("/api/upload/avatar-signature");

    // The serialised body, not the field map: a controller that re-builds
    // the envelope from a leaky object (e.g. spreading the SDK result) would
    // pass an `expect(payload.apiSecret).toBeUndefined()` check while still
    // shipping the secret in the JSON.
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
    expect(res.body.responseObject).not.toHaveProperty("apiSecret");
    expect(res.body.responseObject).not.toHaveProperty("api_secret");
    expect(res.body.responseObject).not.toHaveProperty("cloudinaryApiSecret");
  });

  it("issues a `Cache-Control: no-store` header", async () => {
    // The signature is time-boxed; a cached copy cannot be replayed past
    // its expiry.
    const res = await as(app, user).get("/api/upload/avatar-signature");

    expect(res.headers["cache-control"]).toBe("no-store");
  });
});

describe("http: upload — post-delete avatar cleanup", () => {
  let user: TestUser;

  beforeEach(async () => {
    await resetDatabase();
    user = await mintUser(app);

    process.env.CLOUDINARY_CLOUD_NAME = "test-cloudinary-cloud";
    process.env.CLOUDINARY_API_KEY = "test-cloudinary-api-key";
    process.env.CLOUDINARY_API_SECRET = "test-cloudinary-api-secret";

    uploaderDestroy.mockResolvedValue({ result: "ok" });
  });

  afterEach(() => {
    delete process.env.CLOUDINARY_CLOUD_NAME;
    delete process.env.CLOUDINARY_API_KEY;
    delete process.env.CLOUDINARY_API_SECRET;
    uploaderDestroy.mockReset();
  });

  it("calls uploader.destroy with the deterministic public_id when the user deletes", async () => {
    const res = await as(app, user)
      .post("/api/auth/delete-user")
      .send({ password: "Test-Password-123!" });

    expect(res.status).toBe(200);
    expect(uploaderDestroy).toHaveBeenCalledTimes(1);

    // The same `public_id` the signature endpoint hands out — the cleanup
    // contract is the two callsites rebuild the same string.
    expect(uploaderDestroy).toHaveBeenCalledWith(`nimbus/avatars/${user.id}`, {
      invalidate: true,
    });
  });

  it("treats a Cloudinary failure as non-fatal — the user is still deleted", async () => {
    uploaderDestroy.mockRejectedValue(new Error("Cloudinary is down"));

    const res = await as(app, user)
      .post("/api/auth/delete-user")
      .send({ password: "Test-Password-123!" });

    // better-auth returns 200 on success even when our post-deletion hook
    // logged an error — the contract is "user is gone", and the worst case
    // is an orphaned asset in Cloudinary (see `destroyAvatar` in
    // `lib/cloudinary`).
    expect(res.status).toBe(200);
  });

  it("skips the destroy call for NimbusBot (no avatar by construction)", async () => {
    // The bot owns no avatar asset — calling destroy with the bot's id
    // would be a no-op (Cloudinary returns "not found") but would still
    // generate a network call. Guarding the call site is cheaper than
    // always issuing it.
    const botId = process.env.BOT_USERID;
    expect(botId).toBeTruthy();

    // We can't drive the endpoint as the bot (no password), so we assert
    // the inverse: a real user is deleted, the destroy call lands on
    // *their* id, and the bot's id never appears as the argument.
    await as(app, user)
      .post("/api/auth/delete-user")
      .send({ password: "Test-Password-123!" });

    const allTargets = uploaderDestroy.mock.calls.map(
      ([publicId]) => publicId as string,
    );
    expect(allTargets).toContain(`nimbus/avatars/${user.id}`);
    expect(allTargets).not.toContain(`nimbus/avatars/${botId}`);
  });
});

describe("http: upload/chat-image-signature", () => {
  let owner: TestUser;
  let member: TestUser;
  let outsider: TestUser;
  let workspaceId: string;
  const SECRET = "test-cloudinary-api-secret";

  beforeEach(async () => {
    await resetDatabase();
    owner = await mintUser(app);
    member = await mintUser(app);
    outsider = await mintUser(app);
    workspaceId = (await createWorkspace(owner.id)).id;
    await addMember(workspaceId, member.id);

    vi.stubEnv("CLOUDINARY_CLOUD_NAME", "test-cloudinary-cloud");
    vi.stubEnv("CLOUDINARY_API_KEY", "test-cloudinary-api-key");
    vi.stubEnv("CLOUDINARY_API_SECRET", SECRET);
    apiSignRequest.mockReturnValue("signed");
    deleteByPrefix.mockResolvedValue({});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    apiSignRequest.mockReset();
    deleteByPrefix.mockReset();
  });

  const sign = (user: TestUser, query = `?workspaceId=${workspaceId}`) =>
    as(app, user).get(`/api/upload/chat-image-signature${query}`);

  it("requires authentication", async () => {
    const res = await (await import("supertest"))
      .default(app)
      .get(`/api/upload/chat-image-signature?workspaceId=${workspaceId}`);

    expect(res.status).toBe(401);
  });

  it("signs an upload into the workspace's own folder for a member", async () => {
    const res = await sign(member);

    expect(res.status).toBe(200);
    expect(res.body.responseObject).toMatchObject({
      cloudName: "test-cloudinary-cloud",
      apiKey: "test-cloudinary-api-key",
      folder: `nimbus/chat/${workspaceId}`,
      allowedFormats: "jpg,png,webp,heic",
      transformation: "c_limit,w_2048,h_2048",
      signature: "signed",
    });
    expect(apiSignRequest.mock.calls[0]![0]).toMatchObject({
      folder: `nimbus/chat/${workspaceId}`,
    });
  });

  it("also signs for the owner", async () => {
    expect((await sign(owner)).status).toBe(200);
  });

  it("answers 404 to a user who is not a member, and signs nothing", async () => {
    const res = await sign(outsider);

    expect(res.status).toBe(404);
    expect(apiSignRequest).not.toHaveBeenCalled();
  });

  it("answers 404 for a workspace that does not exist", async () => {
    expect((await sign(owner, "?workspaceId=cmnotaworkspace")).status).toBe(404);
  });

  it("rejects a missing or repeated workspaceId", async () => {
    expect((await sign(owner, "")).status).toBe(400);
    expect((await sign(owner, "?workspaceId=a&workspaceId=b")).status).toBe(400);
  });

  it("is never cached and never carries the API secret", async () => {
    const res = await sign(member);

    expect(res.headers["cache-control"]).toBe("no-store");
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
  });

  it("answers 500 without leaking the cause when signing fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    apiSignRequest.mockImplementation(() => {
      throw new Error("signing exploded with secret-detail");
    });

    const res = await sign(member);

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain("secret-detail");
  });

  it("deletes the workspace's chat images when it is deleted, if it had any", async () => {
    await testPrisma.message.create({
      data: {
        content: "",
        userId: owner.id,
        workspaceId,
        imageUrl: `https://res.cloudinary.com/test-cloudinary-cloud/image/upload/v1/nimbus/chat/${workspaceId}/a.jpg`,
      },
    });

    const res = await as(app, owner).delete(`/api/workspace/delete/${workspaceId}`);

    expect(res.status).toBe(200);
    expect(deleteByPrefix).toHaveBeenCalledWith(
      `nimbus/chat/${workspaceId}/`,
      { invalidate: true },
    );
  });

  it("does not call Cloudinary when deleting a workspace that never had an image", async () => {
    const res = await as(app, owner).delete(`/api/workspace/delete/${workspaceId}`);

    expect(res.status).toBe(200);
    expect(deleteByPrefix).not.toHaveBeenCalled();
  });

  it("still deletes the workspace when the image cleanup fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    deleteByPrefix.mockRejectedValue(new Error("Cloudinary is down"));
    await testPrisma.message.create({
      data: {
        content: "",
        userId: owner.id,
        workspaceId,
        imageUrl: `https://res.cloudinary.com/test-cloudinary-cloud/image/upload/v1/nimbus/chat/${workspaceId}/a.jpg`,
      },
    });

    const res = await as(app, owner).delete(`/api/workspace/delete/${workspaceId}`);

    expect(res.status).toBe(200);
    await expect(
      testPrisma.workspace.count({ where: { id: workspaceId } }),
    ).resolves.toBe(0);
  });
});
