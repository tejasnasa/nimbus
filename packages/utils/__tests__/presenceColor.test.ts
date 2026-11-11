import { describe, expect, it } from "vitest";
import { PRESENCE_PALETTE, presenceColor } from "../src/presenceColor";

describe("presenceColor", () => {
  it("is deterministic for a given user", () => {
    expect(presenceColor("cm_user_1")).toBe(presenceColor("cm_user_1"));
  });

  it("always returns a palette entry in the six-digit form y-prosemirror needs", () => {
    for (const id of ["", "a", "cm_user_1", "cm_user_2", "x".repeat(200)]) {
      const color = presenceColor(id);
      expect(PRESENCE_PALETTE).toContain(color);
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("spreads different users over more than one colour", () => {
    const colors = new Set(
      Array.from({ length: 40 }, (_, i) => presenceColor(`user-${i}`)),
    );
    expect(colors.size).toBeGreaterThan(3);
  });
});
