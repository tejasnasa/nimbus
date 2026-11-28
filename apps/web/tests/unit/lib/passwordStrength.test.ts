/**
 * @module web/tests/unit/lib/passwordStrength
 * @description The strength estimate counts real properties of the typed
 * string: length, mixed case, a digit, and a symbol or a long length.
 */
import { describe, expect, it } from "vitest";
import { scorePassword } from "../../../lib/passwordStrength";

describe("scorePassword", () => {
  it("shows the length hint for an empty password", () => {
    expect(scorePassword("")).toEqual({
      score: 0,
      label: "At least 8 characters.",
    });
  });

  it("calls anything under eight characters too short", () => {
    expect(scorePassword("Ab1!")).toEqual({ score: 0, label: "Too short" });
  });

  it("scores one point per satisfied property", () => {
    expect(scorePassword("lowercase")).toEqual({ score: 1, label: "Weak" });
    expect(scorePassword("Lowercase")).toEqual({ score: 2, label: "Okay" });
    expect(scorePassword("Lowercase1")).toEqual({ score: 3, label: "Good" });
    expect(scorePassword("Lowercase1!")).toEqual({ score: 4, label: "Strong" });
  });

  it("treats fourteen characters as long enough to count without a symbol", () => {
    expect(scorePassword("Lowercase1234567").score).toBe(4);
  });
});
