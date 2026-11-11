/**
 * @module web/tests/unit/lib/documentDownload
 * @description File names built from titles.
 */
import { describe, expect, it } from "vitest";
import { sanitizeFileName } from "../../../lib/documentDownload";

describe("sanitizeFileName", () => {
  it.each([
    ["Quarterly roadmap", "Quarterly roadmap"],
    ["a/b\\c", "a b c"],
    ['what?: "now"*', "what now"],
    ["  spaced   out  ", "spaced out"],
    ["..hidden", "hidden"],
    ["trailing. . .", "trailing"],
    ["tab\tand\nnewline", "tab and newline"],
    ["", "document"],
    ["///", "document"],
    ["...", "document"],
  ])("turns %j into %j", (title, expected) => {
    expect(sanitizeFileName(title)).toBe(expected);
  });

  it("keeps non-latin titles", () => {
    expect(sanitizeFileName("设计 文档")).toBe("设计 文档");
  });

  it("limits the length", () => {
    expect(sanitizeFileName("x".repeat(300))).toHaveLength(80);
  });
});
