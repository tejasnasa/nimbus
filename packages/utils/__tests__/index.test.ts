import { describe, expect, it } from "vitest";
import * as barrel from "../src/index";
import { generateSlug } from "../src/slugGenerator";
import { timeAgo } from "../src/timeAgo";

describe("@nimbus/utils barrel", () => {
  it("exposes exactly the shared helpers", () => {
    expect(Object.keys(barrel).sort()).toEqual(["generateSlug", "timeAgo"]);
  });

  it("re-exports the real implementations, not wrappers", () => {
    expect(barrel.generateSlug).toBe(generateSlug);
    expect(barrel.timeAgo).toBe(timeAgo);
  });

  it("is usable straight from the package entry point", () => {
    expect(barrel.generateSlug("Ada's Dev Lounge!")).toBe("adas-dev-lounge");
    expect(barrel.timeAgo(new Date())).toBe("just now");
  });
});
