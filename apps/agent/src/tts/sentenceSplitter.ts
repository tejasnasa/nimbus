/**
 * @module agent/tts/sentenceSplitter
 * @description Cuts a stream of text deltas into sentences, so the first one
 * can go to speech synthesis while the model is still writing the rest.
 *
 * A sentence ends at `.`, `?` or `!` followed by whitespace (closing quotes and
 * brackets stay with it). A period between digits ("3.5") or after a known
 * abbreviation ("e.g.", "Dr.") is not an end. A sentence that runs past
 * {@link MAX_SENTENCE_CHARS} is cut at the last space before the limit, so one
 * long run-on never delays the first audio.
 *
 * @important Whether a `.` ends a sentence depends on the character after it,
 *            which may arrive in the next delta. The splitter therefore never
 *            releases a sentence whose terminator is the last character seen;
 *            `flush()` releases whatever is left once the stream ends.
 */

/** Longest sentence handed to synthesis, in characters. */
export const MAX_SENTENCE_CHARS = 160;

/** Lower-case words that end in a period without ending the sentence. */
const ABBREVIATIONS = new Set([
  "e.g",
  "i.e",
  "etc",
  "vs",
  "mr",
  "mrs",
  "ms",
  "dr",
  "prof",
  "st",
  "jr",
  "sr",
  "approx",
  "no",
  "inc",
  "ltd",
  "co",
]);

const TERMINATORS = new Set([".", "?", "!"]);
const CLOSERS = new Set(['"', "'", ")", "]", "”", "’"]);

/** Incremental sentence splitter. */
export class SentenceSplitter {
  private buffer = "";

  /**
   * Adds a delta.
   *
   * @param delta - The next piece of text, which may end mid-word.
   * @returns The sentences completed by it, trimmed, in order.
   */
  push(delta: string): string[] {
    this.buffer += delta;
    const out: string[] = [];
    for (;;) {
      const cut = this.findCut();
      if (cut === null) break;
      const sentence = this.buffer.slice(0, cut).trim();
      this.buffer = this.buffer.slice(cut);
      if (sentence) out.push(sentence);
    }
    return out;
  }

  /**
   * Releases whatever is left.
   *
   * @returns The final sentence, or an empty array when nothing is left.
   */
  flush(): string[] {
    const rest = this.buffer.trim();
    this.buffer = "";
    return rest ? [rest] : [];
  }

  /** Index just past the next complete sentence, or null when none is complete. */
  private findCut(): number | null {
    const text = this.buffer;
    for (let i = 0; i < text.length; i++) {
      if (i >= MAX_SENTENCE_CHARS) return this.longCut();
      if (!TERMINATORS.has(text[i]!)) continue;

      let end = i + 1;
      while (
        end < text.length &&
        (TERMINATORS.has(text[end]!) || CLOSERS.has(text[end]!))
      ) {
        end++;
      }
      // The character after the terminator decides; wait for it.
      if (end >= text.length) return null;
      if (!/\s/.test(text[end]!)) continue;
      if (text[i] === "." && this.isAbbreviation(text, i)) continue;
      return end;
    }
    return text.length > MAX_SENTENCE_CHARS ? this.longCut() : null;
  }

  /** Whether the period at `index` closes a known abbreviation. */
  private isAbbreviation(text: string, index: number): boolean {
    const start = text.lastIndexOf(" ", index - 1) + 1;
    const word = text
      .slice(start, index)
      .toLowerCase()
      .replace(/^["'(]+/, "");
    return ABBREVIATIONS.has(word);
  }

  /** Where to cut a sentence that has run past the limit. */
  private longCut(): number {
    const space = this.buffer.lastIndexOf(" ", MAX_SENTENCE_CHARS);
    return space > 0 ? space + 1 : MAX_SENTENCE_CHARS;
  }
}

/**
 * Splits a stream of deltas into a stream of sentences.
 *
 * @param deltas - Text as it arrives.
 */
export async function* sentences(
  deltas: AsyncIterable<string>,
): AsyncGenerator<string> {
  const splitter = new SentenceSplitter();
  for await (const delta of deltas) {
    yield* splitter.push(delta);
  }
  yield* splitter.flush();
}
