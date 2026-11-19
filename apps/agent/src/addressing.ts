/**
 * @module agent/addressing
 * @description Decides which utterances are spoken to the assistant.
 *
 * Two ways in, both spoken:
 *
 * - **Wake phrase.** A final transcript is addressed when, after folding the
 *   assistant's names together, it starts with the name ("Nimbus, what did we
 *   decide?"), has "name," within its first six words ("okay so Nimbus, ..."),
 *   or ends with "name?" ("what do you think, Nimbus?"). A sentence that only
 *   talks about the product ("Nimbus is the product name") is not: a name at
 *   the start followed by a third-person verb is a mention, not a request.
 * - **Wake word alone.** "Nimbus?" or "Hey Nimbus" opens a short window in
 *   which that speaker's next utterance is the question.
 *
 * @important The matching uses the redeemed wake names plus a fixed list of
 *            mishearings seen in transcription ("Mimbus", "Nimbas", "Limbus").
 *            Matching is on whole words only, so "nimbuses" or "limbo" never
 *            wake the assistant.
 */

/** How long a bare wake word keeps the speaker's next utterance addressed. */
export const WAKE_WINDOW_MS = 6000;

/** Mishearings of the assistant's name, folded into it before matching. */
export const WAKE_MISHEARINGS: readonly string[] = [
  "mimbus",
  "nimbas",
  "nimbis",
  "nimbos",
  "limbus",
];

/** Words a sentence may open with before the name ("hey Nimbus"). */
const LEADING_FILLERS = new Set([
  "hey",
  "hi",
  "hello",
  "ok",
  "okay",
  "so",
  "um",
  "uh",
  "and",
  "yo",
]);

/**
 * Words that, right after the name at the start, make the sentence a mention of
 * the product rather than a request to it.
 */
const MENTION_VERBS = new Set([
  "is",
  "isnt",
  "was",
  "wasnt",
  "are",
  "has",
  "had",
  "hasnt",
  "does",
  "doesnt",
  "did",
  "didnt",
  "seems",
  "looks",
  "uses",
  "needs",
  "works",
  "supports",
  "should",
  "shouldnt",
  "already",
  "also",
  "itself",
]);

/** Modals that address the assistant only when followed by "you". */
const MODALS = new Set(["can", "could", "will", "would"]);

/** The canonical word every wake name is folded to. */
const CANONICAL = "nimbus";

/** How a transcript relates to the assistant. */
export type WakeMatch = "none" | "addressed" | "wake-only";

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Builds the folding pattern for a set of wake names: longest first, so
 * "nimbus bot" wins over "nimbus", with flexible spacing inside a name.
 */
function foldPattern(wakeNames: readonly string[]): RegExp {
  const names = [...new Set([...wakeNames, ...WAKE_MISHEARINGS, CANONICAL])]
    .map((name) => name.toLowerCase().trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map((name) => name.split(/\s+/).map(escapeRegExp).join("[\\s-]*"));
  return new RegExp(`\\b(?:${names.join("|")})\\b`, "g");
}

/**
 * Normalises a transcript for matching: lower case, wake names folded to one
 * word, apostrophes dropped, and every other punctuation mark removed except
 * commas and question marks, which the rules read.
 *
 * @param text - The transcript.
 * @param wakeNames - The names that address the assistant.
 */
export function normalise(text: string, wakeNames: readonly string[]): string {
  return text
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(foldPattern(wakeNames), CANONICAL)
    .replace(/[^\p{L}\p{N}\s,?]/gu, " ")
    .replace(/\s*([,?])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Classifies a transcript against the wake rules.
 *
 * @param text - The final transcript of one utterance.
 * @param wakeNames - The names that address the assistant.
 */
export function matchWake(
  text: string,
  wakeNames: readonly string[],
): WakeMatch {
  const folded = normalise(text, wakeNames);
  const tokens = folded.split(" ").filter(Boolean);
  const bare = tokens.map((token) => token.replace(/[,?]/g, ""));

  let start = 0;
  while (start < bare.length && LEADING_FILLERS.has(bare[start]!)) start++;
  const rest = bare.slice(start);
  if (rest.length === 1 && rest[0] === CANONICAL) return "wake-only";

  if (rest[0] === CANONICAL) {
    const next = rest[1];
    const named = tokens[start]!;
    const pausedAfterName = named.endsWith(",") || named.endsWith("?");
    if (pausedAfterName || next === undefined) return "addressed";
    if (MODALS.has(next)) return rest[2] === "you" ? "addressed" : "none";
    if (!MENTION_VERBS.has(next)) return "addressed";
  }

  const firstSix = tokens.slice(0, 6);
  if (firstSix.some((token) => token === `${CANONICAL},`)) return "addressed";
  if (tokens.length > 0 && tokens[tokens.length - 1] === `${CANONICAL}?`)
    return "addressed";
  return "none";
}

/** What the tracker needs from outside. */
export type AddressingOptions = {
  wakeNames: readonly string[];
  /** The clock in milliseconds. Tests only. */
  now?: () => number;
};

/** What {@link Addressing.classify} decided about one utterance. */
export type AddressDecision = {
  addressed: boolean;
  /** A bare wake word: open a window and play the earcon, but do not answer. */
  wakeOnly: boolean;
};

/** Tracks who is talking to the assistant. */
export class Addressing {
  private readonly options: AddressingOptions;
  private readonly now: () => number;
  /** When each speaker's open wake window closes. */
  private readonly windows = new Map<string, number>();

  constructor(options: AddressingOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
  }

  /**
   * Classifies a finished utterance's transcript.
   *
   * @param identity - The speaker, or null when unknown.
   * @param text - The final transcript.
   */
  classify(identity: string | null, text: string): AddressDecision {
    const match = matchWake(text, this.options.wakeNames);
    if (!identity) return { addressed: match === "addressed", wakeOnly: false };

    const at = this.now();
    const windowUntil = this.windows.get(identity);
    this.windows.delete(identity);
    if (match === "wake-only") {
      this.windows.set(identity, at + WAKE_WINDOW_MS);
      return { addressed: true, wakeOnly: true };
    }
    if (windowUntil !== undefined && at <= windowUntil) {
      return { addressed: true, wakeOnly: false };
    }
    return { addressed: match === "addressed", wakeOnly: false };
  }
}
