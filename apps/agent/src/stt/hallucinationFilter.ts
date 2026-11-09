/**
 * @module agent/stt/hallucinationFilter
 * @description Drops transcription results that are not speech.
 *
 * Transcription models invent text for near-silence: a stock sign-off, a single
 * word, a loop of one token. Measured on silence and noise, the families in use
 * answered with "Thank you for watching.", "you", "Hey" and, for a few,
 * nothing. The filter removes those without touching real speech.
 *
 * @important A stock phrase is dropped only when the clip was also quiet. "Thank
 *            you for watching" is a perfectly good thing for a person to say in
 *            a call, and at normal speaking level it is kept. Dropped results
 *            are still counted for usage, because the provider billed for them.
 */

/** Level (0 to 1 RMS) below which a clip counts as quiet. */
export const QUIET_RMS = 0.02;

/**
 * Phrases models produce on silence, compared after normalisation. Anything
 * starting "subtitles by" is also treated as one, whoever it credits.
 */
export const HALLUCINATION_PHRASES: readonly string[] = [
  "thank you for watching",
  "thanks for watching",
  "thank you",
  "thanks",
  "you",
  "hey",
  "bye",
  "please subscribe",
];

/** Repeats of one token at which a result is judged a loop. */
const REPEAT_LIMIT = 4;

/** Lower-cases, strips punctuation and collapses whitespace. */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Decides whether a transcription result should be discarded.
 *
 * @param text - The model's output.
 * @param rms - Level of the clip it came from, 0 to 1.
 * @returns True when the text is empty, a stock phrase over a quiet clip, or one
 *          token repeated.
 */
export function isHallucination(text: string, rms: number): boolean {
  const normal = normalise(text);
  if (normal.length === 0) return true;

  if (
    rms < QUIET_RMS &&
    (HALLUCINATION_PHRASES.includes(normal) || normal.startsWith("subtitles by"))
  ) {
    return true;
  }

  const tokens = normal.split(" ");
  return tokens.length >= REPEAT_LIMIT && new Set(tokens).size === 1;
}
