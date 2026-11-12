import { describe, expect, it } from "vitest";
import {
  charAdvance,
  measureLabel,
  measureText,
  wrapText,
} from "../../src/diagram/measure";

const FONT = 16;
const opts = (maxWidth: number) => ({
  fontSize: FONT,
  lineHeight: 1.35,
  maxWidth,
});

describe("charAdvance", () => {
  it("reads exact ASCII advances from the font table", () => {
    expect(charAdvance(" ".codePointAt(0)!)).toBe(0.5);
    expect(charAdvance("i".codePointAt(0)!)).toBe(0.219);
    expect(charAdvance("W".codePointAt(0)!)).toBe(0.746);
    expect(charAdvance("~".codePointAt(0)!)).toBe(0.841);
  });

  it("makes narrow letters narrower than wide ones", () => {
    expect(charAdvance(0x69)).toBeLessThan(charAdvance(0x6d));
  });

  it("treats CJK, Hangul and full-width forms as one em", () => {
    expect(charAdvance("中".codePointAt(0)!)).toBe(1);
    expect(charAdvance("あ".codePointAt(0)!)).toBe(1);
    expect(charAdvance("한".codePointAt(0)!)).toBe(1);
    expect(charAdvance("Ａ".codePointAt(0)!)).toBe(1);
  });

  it("gives emoji more than an em", () => {
    expect(charAdvance("😀".codePointAt(0)!)).toBeGreaterThan(1);
    expect(charAdvance("✅".codePointAt(0)!)).toBeGreaterThan(1);
  });

  it("gives joiners, variation selectors and marks no width", () => {
    for (const cp of [0x200d, 0xfe0f, 0x301, 0x1f3fd, 0x0a, 0x85]) {
      expect(charAdvance(cp)).toBe(0);
    }
  });

  it("uses a per-class estimate for accents, other scripts and punctuation", () => {
    expect(charAdvance("é".codePointAt(0)!)).toBeCloseTo(0.6);
    expect(charAdvance("Ж".codePointAt(0)!)).toBeCloseTo(0.6);
    expect(charAdvance(0x2014)).toBeCloseTo(0.911);
    expect(charAdvance(0xa0)).toBe(0.5);
  });
});

describe("measureText", () => {
  it("sums glyph advances scaled by the font size", () => {
    expect(measureText("ii", FONT)).toBeCloseTo(0.438 * FONT);
    expect(measureText("", FONT)).toBe(0);
  });

  it("counts an astral character once, not as two surrogates", () => {
    expect(measureText("😀", FONT)).toBeCloseTo(1.2 * FONT);
  });

  it("scales linearly with font size", () => {
    expect(measureText("Hello", 32)).toBeCloseTo(2 * measureText("Hello", 16));
  });
});

describe("wrapText", () => {
  it("keeps a short label on one line", () => {
    expect(wrapText("Hello world", 400, FONT)).toEqual(["Hello world"]);
  });

  it("wraps at word boundaries without exceeding the width", () => {
    const text = "the quick brown fox jumps over the lazy dog";
    const lines = wrapText(text, 120, FONT);

    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(" ")).toBe(text);
    for (const line of lines) {
      expect(measureText(line, FONT)).toBeLessThanOrEqual(120);
    }
  });

  it("breaks a word longer than a line by character", () => {
    const word = "x".repeat(60);
    const lines = wrapText(word, 100, FONT);

    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join("")).toBe(word);
    for (const line of lines) {
      expect(measureText(line, FONT)).toBeLessThanOrEqual(100);
    }
  });

  it("flushes the line in progress before an overlong word", () => {
    const lines = wrapText(`ok ${"y".repeat(60)}`, 100, FONT);

    expect(lines[0]).toBe("ok");
  });

  it("honours explicit newlines and drops blank paragraphs", () => {
    expect(wrapText("a\n\n  \nb", 400, FONT)).toEqual(["a", "b"]);
    expect(wrapText("a\r\nb", 400, FONT)).toEqual(["a", "b"]);
  });

  it("returns one line for empty text", () => {
    expect(wrapText("", 100, FONT)).toEqual([" "]);
    expect(wrapText("   ", 100, FONT)).toEqual([" "]);
  });

  it("wraps CJK text, which has no spaces, by character", () => {
    const lines = wrapText("日本語のラベルがとても長い場合", 80, FONT);

    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join("")).toBe("日本語のラベルがとても長い場合");
  });

  it("puts one glyph per line when the limit is narrower than a glyph", () => {
    expect(wrapText("abc", 1, FONT)).toEqual(["a", "b", "c"]);
  });

  it("never splits an emoji surrogate pair", () => {
    const lines = wrapText("😀😀😀😀😀😀", 40, FONT);

    expect(lines.join("")).toBe("😀😀😀😀😀😀");
    for (const line of lines) expect(line).not.toMatch(/[\ud800-\udbff]$/);
  });
});

describe("measureLabel", () => {
  it("reports width and a height of lines times line height", () => {
    const one = measureLabel("Hello", opts(Infinity));
    const three = measureLabel("a\nb\nc", opts(Infinity));

    expect(one.lines).toEqual(["Hello"]);
    expect(one.height).toBe(Math.ceil(FONT * 1.35));
    expect(three.lines).toHaveLength(3);
    expect(three.height).toBe(Math.ceil(3 * FONT * 1.35));
  });

  it("adds headroom over the raw glyph advance", () => {
    const m = measureLabel("Hello", opts(Infinity));

    expect(m.width).toBeGreaterThan(measureText("Hello", FONT));
  });

  it("never reports a width over the wrap limit", () => {
    const m = measureLabel("lorem ipsum dolor sit amet consectetur", opts(150));

    expect(m.width).toBeLessThanOrEqual(150 + 1);
    expect(m.lines.length).toBeGreaterThan(1);
  });

  it("measures CJK and emoji wider than the same count of ASCII letters", () => {
    const ascii = measureLabel("abcd", opts(Infinity)).width;

    expect(measureLabel("中文标签", opts(Infinity)).width).toBeGreaterThan(
      ascii,
    );
    expect(measureLabel("😀😀😀😀", opts(Infinity)).width).toBeGreaterThan(
      measureLabel("中文标签", opts(Infinity)).width,
    );
  });

  it("is deterministic", () => {
    const a = measureLabel("Same input, same output", opts(120));
    const b = measureLabel("Same input, same output", opts(120));

    expect(b).toEqual(a);
  });
});
