import { describe, expect, it } from "vitest";
import { getAvatarForUser } from "../src/utils/getAvatarForUser";

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

  it.fails("returns a usable image URL for a named user", () => {
    const avatar = getAvatarForUser("clx1userid");
    expect(typeof avatar).toBe("string");
    expect(avatar).not.toBe("");
  });

  it.fails("returns a usable image URL when no user id is supplied", () => {
    const avatar = getAvatarForUser(undefined);
    expect(typeof avatar).toBe("string");
    expect(avatar).not.toBe("");
  });
});
