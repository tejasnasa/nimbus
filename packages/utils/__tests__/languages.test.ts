/**
 * @module utils/__tests__/languages
 * @description The caption language list: unique ISO-639-1 codes, and the
 * lookups the picker and the server validation build on.
 */
import { describe, expect, it } from "vitest";
import {
  CAPTION_LANGUAGES,
  captionLanguageLabel,
  isCaptionLanguage,
  normalizeCaptionLanguage,
} from "../src/languages";

describe("CAPTION_LANGUAGES", () => {
  it("has unique, lower-case two-letter codes and labelled entries", () => {
    const codes = CAPTION_LANGUAGES.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const language of CAPTION_LANGUAGES) {
      expect(language.code).toMatch(/^[a-z]{2}$/);
      expect(language.label.length).toBeGreaterThan(0);
    }
  });

  it("contains the twenty launch languages", () => {
    expect(CAPTION_LANGUAGES).toHaveLength(20);
    expect(isCaptionLanguage("hi")).toBe(true);
    expect(isCaptionLanguage("ur")).toBe(true);
  });
});

describe("isCaptionLanguage", () => {
  it("rejects unknown codes and non-strings", () => {
    expect(isCaptionLanguage("xx")).toBe(false);
    expect(isCaptionLanguage("EN")).toBe(false);
    expect(isCaptionLanguage(null)).toBe(false);
    expect(isCaptionLanguage(7)).toBe(false);
  });
});

describe("captionLanguageLabel", () => {
  it("returns the label, or the code when unsupported", () => {
    expect(captionLanguageLabel("de")).toBe("German");
    expect(captionLanguageLabel("zz")).toBe("zz");
  });
});

describe("normalizeCaptionLanguage", () => {
  it("reduces regional codes and names to a supported code", () => {
    expect(normalizeCaptionLanguage("en-US")).toBe("en");
    expect(normalizeCaptionLanguage("pt_BR")).toBe("pt");
    expect(normalizeCaptionLanguage(" Hindi ")).toBe("hi");
  });

  it("returns null for absent or unknown input", () => {
    expect(normalizeCaptionLanguage(null)).toBeNull();
    expect(normalizeCaptionLanguage(undefined)).toBeNull();
    expect(normalizeCaptionLanguage("")).toBeNull();
    expect(normalizeCaptionLanguage("klingon")).toBeNull();
  });
});
