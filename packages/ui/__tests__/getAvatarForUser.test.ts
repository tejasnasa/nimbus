import { describe, expect, it } from "vitest";
import { assetSrc, getAvatarForUser } from "../src/utils/getAvatarForUser";

describe("getAvatarForUser", () => {
  it("returns the same avatar for the same user every time", () => {
    const first = getAvatarForUser("clx1userid");
    expect(getAvatarForUser("clx1userid")).toBe(first);
    expect(getAvatarForUser("clx1userid")).toBe(first);
  });

  it("treats a numeric id and its string form as the same user", () => {
    expect(getAvatarForUser(42)).toBe(getAvatarForUser("42"));
  });

  it("is stable across a large sample of ids (hash is pure)", () => {
    const ids = Array.from({ length: 200 }, (_, i) => `user-${i}`);
    const first = ids.map(getAvatarForUser);
    const second = ids.map(getAvatarForUser);
    expect(second).toEqual(first);
  });

  it("returns a usable image URL for a named user", () => {
    const avatar = getAvatarForUser("clx1userid");
    expect(typeof avatar).toBe("string");
    expect(avatar).not.toBe("");
  });

  it("returns a usable image URL when no user id is supplied", () => {
    const avatar = getAvatarForUser(undefined);
    expect(typeof avatar).toBe("string");
    expect(avatar).not.toBe("");
  });
});

describe("assetSrc", () => {
  it("accepts the bare URL string Vite hands back", () => {
    expect(assetSrc("/assets/avatars/picture1.jpg")).toBe(
      "/assets/avatars/picture1.jpg",
    );
  });

  it("unwraps the metadata object Next.js hands back", () => {
    const nextAsset = {
      src: "/_next/static/picture1.jpg",
      height: 64,
      width: 64,
    };
    expect(assetSrc(nextAsset)).toBe("/_next/static/picture1.jpg");
  });

  it("returns an empty string when neither shape matches", () => {
    expect(assetSrc(undefined)).toBe("");
    expect(assetSrc({ height: 64 })).toBe("");
    expect(assetSrc({ src: 42 })).toBe("");
  });
});
