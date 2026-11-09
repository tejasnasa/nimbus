/**
 * @module agent/stt/glossary
 * @description Repairs the spelling of names a transcription model gets wrong.
 *
 * The provider the free tier runs on ignores a vocabulary prompt, and measured
 * output spelled the product names as "Nimbusbot", "live kit" and "Mimbus".
 * This pass runs after transcription: product names are matched ignoring case
 * and spacing, then by a small edit distance; member names are only corrected
 * for case.
 *
 * @important Fuzzy matching applies to product terms only. Matching member names
 *            by edit distance would rewrite ordinary words into names (a
 *            member called Alice would turn "place" into "Alice"), so a member
 *            name is fixed only when the model produced the same letters in the
 *            wrong case.
 */

/** Terms the product itself uses, spelled as they should appear. */
export const PRODUCT_TERMS: readonly string[] = [
  "NimbusBot",
  "Nimbus",
  "Excalidraw",
  "LiveKit",
];

/** Shortest word that fuzzy matching will consider. */
const MIN_FUZZY_LENGTH = 5;

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Levenshtein distance, with an early exit above `limit`. */
export function editDistance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
      current.push(value);
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > limit) return limit + 1;
    previous = current;
  }
  return previous[b.length] ?? limit + 1;
}

/** Edits tolerated for a word of the given length. */
const toleranceFor = (length: number) => (length >= 8 ? 2 : 1);

/**
 * Builds a function that normalises names in transcribed text.
 *
 * @param memberNames - Display names of the workspace's members.
 * @returns The normaliser.
 */
export function createGlossary(
  memberNames: readonly string[],
): (text: string) => string {
  const spaced = PRODUCT_TERMS.map((term) => ({
    term,
    // "nimbus bot", "live-kit" and "Nimbus  Bot" all match "NimbusBot"/"LiveKit".
    pattern: new RegExp(
      `\\b${[...term].map(escapeRegExp).join("[\\s-]?")}\\b`,
      "gi",
    ),
  }));

  const words = new Map<string, string>();
  for (const name of memberNames) {
    for (const part of name.split(/\s+/)) {
      const cleaned = part.replace(/[^\p{L}\p{N}'-]/gu, "");
      if (cleaned.length >= 3) words.set(cleaned.toLowerCase(), cleaned);
    }
  }
  const productByLower = new Map(
    PRODUCT_TERMS.map((term) => [term.toLowerCase(), term] as const),
  );

  return (text: string) => {
    let out = text;
    // Longest terms first, so "NimbusBot" is not consumed as "Nimbus" + "Bot".
    for (const { term, pattern } of spaced) out = out.replace(pattern, term);

    return out.replace(/[\p{L}\p{N}'-]+/gu, (word) => {
      const lower = word.toLowerCase();
      const product = productByLower.get(lower);
      if (product) return product;
      const member = words.get(lower);
      if (member) return member;
      if (word.length < MIN_FUZZY_LENGTH) return word;
      const limit = toleranceFor(word.length);
      let best: { term: string; distance: number } | null = null;
      for (const term of PRODUCT_TERMS) {
        const distance = editDistance(lower, term.toLowerCase(), limit);
        if (distance <= limit && (!best || distance < best.distance)) {
          best = { term, distance };
        }
      }
      return best ? best.term : word;
    });
  };
}
