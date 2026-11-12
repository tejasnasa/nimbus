/**
 * @module utils/diagram/measure
 * @description Deterministic text measurement for diagram labels, with no
 * canvas, DOM or font file at runtime.
 *
 * Widths come from a table of per-character advances for Virgil, the font the
 * Excalidraw builder assigns to every label (`fontFamily: 1`). ASCII has an
 * exact entry; Latin accents, CJK, emoji and the remaining scripts use a
 * per-class estimate. Labels are wrapped greedily at word boundaries (long
 * words break by character) and a wrapped label's height is its line count
 * times the line height.
 *
 * @important The table is Virgil's. If the builder's `fontFamily` changes,
 *            regenerate the table from the new font's `hmtx`; node sizes, wrap
 *            points and the text element dimensions all derive from it, so a
 *            stale table makes labels overflow their boxes again.
 */

/** Advance widths (in em) for U+0020 through U+007E, from Virgil's `hmtx`. */
const ASCII_ADVANCES: readonly number[] = [
  0.5, 0.296, 0.328, 0.797, 0.803, 0.939, 0.719, 0.266, 0.415, 0.338, 0.516,
  0.625, 0.257, 0.411, 0.274, 0.5, 0.688, 0.271, 0.712, 0.681, 0.64, 0.618,
  0.64, 0.538, 0.765, 0.609, 0.242, 0.258, 0.605, 0.617, 0.485, 0.466, 0.805,
  0.656, 0.727, 0.644, 0.78, 0.674, 0.574, 0.789, 0.551, 0.545, 0.634, 0.613,
  0.599, 0.766, 0.644, 0.726, 0.661, 0.705, 0.678, 0.608, 0.804, 0.714, 0.517,
  0.746, 0.598, 0.516, 0.797, 0.491, 0.5, 0.5, 0.544, 0.826, 0.437, 0.667,
  0.508, 0.502, 0.569, 0.547, 0.486, 0.501, 0.494, 0.219, 0.328, 0.487, 0.263,
  0.633, 0.467, 0.554, 0.493, 0.546, 0.43, 0.543, 0.565, 0.568, 0.523, 0.609,
  0.562, 0.469, 0.572, 0.573, 0.168, 0.496, 0.841,
];

/** Estimated advance for Latin-1/Latin Extended letters and other alphabets. */
const ALPHABETIC_ADVANCE = 0.6;
/** Full-width glyphs: CJK ideographs, kana, Hangul and full-width forms. */
const WIDE_ADVANCE = 1;
/** Colour emoji and pictographs render a little wider than one em. */
const EMOJI_ADVANCE = 1.2;
/** Headroom applied to measured widths so rendering differences never clip. */
const MEASURE_SAFETY = 1.03;

const SPECIAL_ADVANCES = new Map<number, number>([
  [0x2013, 0.6],
  [0x2014, 0.911],
  [0x2018, 0.3],
  [0x2019, 0.3],
  [0x201c, 0.42],
  [0x201d, 0.42],
  [0x2022, 0.5],
  [0x2026, 0.677],
]);

function inRange(cp: number, lo: number, hi: number) {
  return cp >= lo && cp <= hi;
}

/** True for code points that add no advance (joiners, selectors, marks). */
function isZeroWidth(cp: number) {
  return (
    cp < 0x20 ||
    inRange(cp, 0x7f, 0x9f) ||
    inRange(cp, 0x300, 0x36f) ||
    cp === 0x200b ||
    cp === 0x200c ||
    cp === 0x200d ||
    inRange(cp, 0xfe00, 0xfe0f) ||
    inRange(cp, 0x1f3fb, 0x1f3ff) ||
    inRange(cp, 0xe0020, 0xe007f)
  );
}

function isWide(cp: number) {
  return (
    inRange(cp, 0x1100, 0x11ff) ||
    inRange(cp, 0x2e80, 0x9fff) ||
    inRange(cp, 0xac00, 0xd7af) ||
    inRange(cp, 0xf900, 0xfaff) ||
    inRange(cp, 0xff00, 0xff60) ||
    inRange(cp, 0xffe0, 0xffe6) ||
    inRange(cp, 0x20000, 0x2fa1f)
  );
}

function isEmoji(cp: number) {
  return (
    inRange(cp, 0x1f000, 0x1faff) ||
    inRange(cp, 0x2600, 0x27bf) ||
    inRange(cp, 0x2b00, 0x2bff) ||
    inRange(cp, 0x2190, 0x21ff) ||
    inRange(cp, 0x2300, 0x23ff)
  );
}

/**
 * Advance width of one code point, in em.
 *
 * @param codePoint - Unicode code point.
 * @returns Width as a fraction of the font size (0 for joiners and marks).
 */
export function charAdvance(codePoint: number): number {
  if (inRange(codePoint, 0x20, 0x7e)) return ASCII_ADVANCES[codePoint - 0x20]!;
  if (codePoint === 0xa0) return ASCII_ADVANCES[0]!;
  if (isZeroWidth(codePoint)) return 0;
  const special = SPECIAL_ADVANCES.get(codePoint);
  if (special !== undefined) return special;
  if (isWide(codePoint)) return WIDE_ADVANCE;
  if (isEmoji(codePoint)) return EMOJI_ADVANCE;
  return ALPHABETIC_ADVANCE;
}

/**
 * Width of a single line of text.
 *
 * @param text - Text without line breaks.
 * @param fontSize - Font size in px.
 * @returns Sum of the glyph advances, in px (no safety margin).
 */
export function measureText(text: string, fontSize: number): number {
  let em = 0;
  for (const char of text) em += charAdvance(char.codePointAt(0)!);
  return em * fontSize;
}

/**
 * Greedy word-wrap honouring explicit newlines. A word wider than the limit is
 * split by character; every line holds at least one character so wrapping always
 * terminates.
 *
 * @param text - Label text.
 * @param maxWidth - Widest allowed line in px.
 * @param fontSize - Font size in px.
 * @returns At least one line.
 */
export function wrapText(
  text: string,
  maxWidth: number,
  fontSize: number,
): string[] {
  const limit = maxWidth / MEASURE_SAFETY;
  const lines: string[] = [];

  for (const paragraph of text.split(/\r?\n/)) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    let current = "";

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (measureText(candidate, fontSize) <= limit) {
        current = candidate;
        continue;
      }
      if (current) {
        lines.push(current);
        current = "";
      }
      if (measureText(word, fontSize) <= limit) {
        current = word;
        continue;
      }
      for (const char of word) {
        if (current && measureText(current + char, fontSize) > limit) {
          lines.push(current);
          current = "";
        }
        current += char;
      }
    }
    if (current) lines.push(current);
  }

  return lines.length > 0 ? lines : [text.trim() || " "];
}

/** A label wrapped and measured. */
export type MeasuredLabel = {
  lines: string[];
  /** Widest line, safety margin included. */
  width: number;
  /** `lines.length * fontSize * lineHeight`. */
  height: number;
};

/**
 * Wraps and measures a label.
 *
 * @param text - Label text (explicit `\n` kept as breaks).
 * @param options - Font size, line-height multiplier and the wrap width
 *                  (`Infinity` measures the text as already wrapped).
 * @returns Lines plus the box they occupy.
 */
export function measureLabel(
  text: string,
  options: { fontSize: number; lineHeight: number; maxWidth: number },
): MeasuredLabel {
  const { fontSize, lineHeight, maxWidth } = options;
  const lines = wrapText(text, maxWidth, fontSize);
  const widest = Math.max(...lines.map((line) => measureText(line, fontSize)));

  return {
    lines,
    width: Math.ceil(widest * MEASURE_SAFETY),
    height: Math.ceil(lines.length * fontSize * lineHeight),
  };
}
