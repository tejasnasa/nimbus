/**
 * @module api/__tests__/unit/cloudinary
 * @description The chat-image half of `lib/cloudinary`: the signed upload
 * parameters, and the ownership check every server path that accepts an image
 * URL relies on. The Cloudinary SDK is mocked at the module boundary — no
 * request is made and no key is needed.
 *
 * The ownership check is the security-relevant part, so it is tested as a
 * table of hostile URLs, not as a happy path with a couple of negatives.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { apiSignRequest, deleteByPrefix } = vi.hoisted(() => ({
  apiSignRequest: vi.fn(),
  deleteByPrefix: vi.fn(),
}));

vi.mock("cloudinary", () => ({
  v2: {
    config: vi.fn(),
    utils: { api_sign_request: apiSignRequest },
    uploader: { destroy: vi.fn() },
    api: { delete_resources_by_prefix: deleteByPrefix },
  },
}));

import {
  CHAT_IMAGE_ALLOWED_FORMATS,
  CHAT_IMAGE_FOLDER,
  CHAT_IMAGE_TRANSFORMATION,
  destroyChatImages,
  getChatImageSignature,
  isOwnedChatImageUrl,
} from "../../lib/cloudinary";

const CLOUD = "acme-cloud";
const WS = "cmworkspace0000000000000001";
const base = `https://res.cloudinary.com/${CLOUD}/image/upload`;
const own = `${base}/v1700000000/${CHAT_IMAGE_FOLDER}/${WS}/ckabc123.jpg`;

beforeEach(() => {
  vi.stubEnv("CLOUDINARY_CLOUD_NAME", CLOUD);
  vi.stubEnv("CLOUDINARY_API_KEY", "key");
  vi.stubEnv("CLOUDINARY_API_SECRET", "secret-that-must-not-leak");
  apiSignRequest.mockReturnValue("signature");
  deleteByPrefix.mockResolvedValue({});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  apiSignRequest.mockReset();
  deleteByPrefix.mockReset();
});

describe("getChatImageSignature", () => {
  it("signs the folder, a fresh public id, the formats and the size limit", () => {
    const sig = getChatImageSignature(WS, "user-1");

    expect(sig).toMatchObject({
      cloudName: CLOUD,
      apiKey: "key",
      folder: `nimbus/chat/${WS}`,
      allowedFormats: "jpg,png,webp,heic",
      transformation: CHAT_IMAGE_TRANSFORMATION,
      context: "uploader=user-1",
      signature: "signature",
    });
    expect(sig.publicId).toMatch(/^c[a-z0-9]{20,}$/);
    expect(CHAT_IMAGE_ALLOWED_FORMATS).toBe("jpg,png,webp,heic");

    const [signed, secret] = apiSignRequest.mock.calls[0]!;
    expect(signed).toEqual({
      allowed_formats: "jpg,png,webp,heic",
      context: "uploader=user-1",
      folder: `nimbus/chat/${WS}`,
      public_id: sig.publicId,
      timestamp: sig.timestamp,
      transformation: "c_limit,w_2048,h_2048",
    });
    expect(secret).toBe("secret-that-must-not-leak");
  });

  it("limits the long edge to 2048 pixels without enlarging", () => {
    expect(CHAT_IMAGE_TRANSFORMATION).toBe("c_limit,w_2048,h_2048");
  });

  it("never returns the API secret", () => {
    const sig = getChatImageSignature(WS, "user-1");

    expect(JSON.stringify(sig)).not.toContain("secret-that-must-not-leak");
  });

  it("uses a different public id every time", () => {
    const a = getChatImageSignature(WS, "u").publicId;
    const b = getChatImageSignature(WS, "u").publicId;

    expect(a).not.toBe(b);
  });
});

describe("isOwnedChatImageUrl", () => {
  it("accepts an image in the workspace's own folder", () => {
    expect(isOwnedChatImageUrl(own, WS)).toBe(true);
  });

  it("accepts the delivery URL without a version and with a transformation", () => {
    expect(
      isOwnedChatImageUrl(`${base}/nimbus/chat/${WS}/ckabc123.jpg`, WS),
    ).toBe(true);
    expect(
      isOwnedChatImageUrl(
        `${base}/c_limit,w_2048,h_2048/v1/nimbus/chat/${WS}/ckabc123.png`,
        WS,
      ),
    ).toBe(true);
  });

  it("accepts a URL with no file extension", () => {
    expect(
      isOwnedChatImageUrl(`${base}/v1/nimbus/chat/${WS}/ckabc123`, WS),
    ).toBe(true);
  });

  it.each([
    ["another workspace", own.replace(WS, `${WS}2`)],
    ["another cloud", own.replace(CLOUD, "other-cloud")],
    ["another host", own.replace("res.cloudinary.com", "evil.example")],
    [
      "a look-alike host",
      own.replace("res.cloudinary.com", "res.cloudinary.com.evil.example"),
    ],
    [
      "a subdomain host",
      own.replace("res.cloudinary.com", "x.res.cloudinary.com"),
    ],
    ["plain http", own.replace("https:", "http:")],
    ["a data: URL", "data:image/png;base64,AAAA"],
    ["a file: URL", "file:///etc/passwd"],
    ["a different folder", own.replace("nimbus/chat", "nimbus/avatars")],
    ["the avatar folder", `${base}/v1/nimbus/avatars/${WS}`],
    ["a video resource", own.replace("/image/", "/video/")],
    ["a non-upload delivery type", own.replace("/upload/", "/private/")],
    ["dot-dot segments", `${base}/v1/../nimbus/chat/${WS}/a.jpg`],
    ["a dot segment", `${base}/./nimbus/chat/${WS}/a.jpg`],
    ["an encoded slash", `${base}/v1/nimbus%2Fchat/${WS}/a.jpg`],
    ["an encoded slash (upper case)", `${base}/v1/nimbus%2fchat/${WS}/a.jpg`],
    ["an encoded dot", `${base}/v1/%2e%2e/nimbus/chat/${WS}/a.jpg`],
    ["an encoded backslash", `${base}/v1/nimbus%5Cchat/${WS}/a.jpg`],
    ["a backslash", `${base}/v1/nimbus\\chat/${WS}/a.jpg`],
    ["a nul byte", `${base}/v1/nimbus/chat/${WS}/a%00.jpg`],
    ["embedded credentials", own.replace("https://", "https://user:pw@")],
    [
      "an explicit port",
      own.replace("res.cloudinary.com", "res.cloudinary.com:8443"),
    ],
    [
      "a nested path under the workspace",
      `${base}/v1/nimbus/chat/${WS}/sub/a.jpg`,
    ],
    ["a trailing slash", `${own}/`],
    ["the folder itself", `${base}/v1/nimbus/chat/${WS}/`],
    ["an odd file name", `${base}/v1/nimbus/chat/${WS}/a b.jpg`],
    ["no path at all", "https://res.cloudinary.com/"],
    ["an empty string", ""],
    ["not a URL", "not a url"],
  ])("rejects %s", (_name, url) => {
    expect(isOwnedChatImageUrl(url, WS)).toBe(false);
  });

  it("rejects values that are not strings", () => {
    expect(isOwnedChatImageUrl(undefined, WS)).toBe(false);
    expect(isOwnedChatImageUrl(null, WS)).toBe(false);
    expect(isOwnedChatImageUrl({ toString: () => own }, WS)).toBe(false);
    expect(isOwnedChatImageUrl([own], WS)).toBe(false);
  });

  it("rejects a workspace id that could widen the match", () => {
    expect(isOwnedChatImageUrl(own, "")).toBe(false);
    expect(isOwnedChatImageUrl(own, "../x")).toBe(false);
    expect(isOwnedChatImageUrl(own, "a/b")).toBe(false);
  });

  it("rejects everything when the deployment has no cloud name configured", () => {
    vi.stubEnv("CLOUDINARY_CLOUD_NAME", "");

    expect(isOwnedChatImageUrl(own, WS)).toBe(false);
  });
});

describe("destroyChatImages", () => {
  it("deletes the workspace's folder by prefix", async () => {
    await destroyChatImages(WS);

    expect(deleteByPrefix).toHaveBeenCalledWith(`nimbus/chat/${WS}/`, {
      invalidate: true,
    });
  });

  it("logs and swallows a Cloudinary failure", async () => {
    deleteByPrefix.mockRejectedValue(new Error("rate limited"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(destroyChatImages(WS)).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
  });
});
