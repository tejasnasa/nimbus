/**
 * @module agent/__tests__/glossary
 * @description Name repair after transcription: product terms by spacing and by
 * edit distance, member names by case only.
 */
import { describe, expect, it } from "vitest";
import { createGlossary, editDistance } from "../stt/glossary.js";

describe("createGlossary", () => {
  const fix = createGlossary(["Priya Shah", "Alice Wong"]);

  it.each([
    ["ask nimbus bot to draw it", "ask NimbusBot to draw it"],
    ["ask Nimbusbot to draw it", "ask NimbusBot to draw it"],
    ["we use live kit for calls", "we use LiveKit for calls"],
    ["open the xcalidraw board", "open the Excalidraw board"],
    ["hey Mimbus, summarise", "hey Nimbus, summarise"],
    ["hey nimbus", "hey Nimbus"],
  ])("repairs %j", (input, expected) => {
    expect(fix(input)).toBe(expected);
  });

  it("fixes the case of a member name", () => {
    expect(fix("thanks priya, over to alice")).toBe(
      "thanks Priya, over to Alice",
    );
  });

  it("does not turn ordinary words into a member name by edit distance", () => {
    expect(fix("meet me at the place")).toBe("meet me at the place");
  });

  it("does not turn ordinary words into product terms", () => {
    expect(fix("the numbers look fine")).toBe("the numbers look fine");
  });

  it("leaves short words alone", () => {
    expect(fix("nim bus is not a word")).toContain("Nimbus");
    expect(fix("kit")).toBe("kit");
  });

  it("works without any member names", () => {
    expect(createGlossary([])("nimbus")).toBe("Nimbus");
  });
});

describe("editDistance", () => {
  it("counts insertions, deletions and substitutions", () => {
    expect(editDistance("kitten", "sitting", 5)).toBe(3);
    expect(editDistance("same", "same", 2)).toBe(0);
  });

  it("gives up early beyond the limit", () => {
    expect(editDistance("abcdef", "uvwxyz", 1)).toBeGreaterThan(1);
    expect(editDistance("a", "abcdefgh", 2)).toBeGreaterThan(2);
  });
});
