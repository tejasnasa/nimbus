/**
 * @module agent/addressing
 * @description Decides which utterances are spoken to the assistant.
 *
 * Three ways in:
 *
 * - **Wake phrase.** A final transcript is addressed when, after folding the
 *   assistant's names together, it starts with the name ("Nimbus, what did we
 *   decide?"), has "name," within its first six words ("okay so Nimbus, ..."),
 *   or ends with "name?" ("what do you think, Nimbus?"). A sentence that only
 *   talks about the product ("Nimbus is the product name") is not: a name at
 *   the start followed by a third-person verb is a mention, not a request.
 * - **Wake word alone.** "Nimbus?" or "Hey Nimbus" opens a short window in
 *   which that speaker's next utterance is the question.
 * - **Ask button.** While a person holds it, everything they say is addressed;
 *   after release, an utterance that finishes within a short grace still
 *   counts, and a release with no utterance in that grace cancels the ask.
 *
 * @important The matching uses the redeemed wake names plus a fixed list of
 *            mishearings seen in transcription ("Mimbus", "Nimbas", "Limbus").
 *            Matching is on whole words only, so "nimbuses" or "limbo" never
 *            wake the assistant.
 */

/** How long a bare wake word keeps the speaker's next utterance addressed. */
export const WAKE_WINDOW_MS = 6000;

/** How long after the Ask button is released an utterance still counts. */
export const ASK_RELEASE_GRACE_MS = 1500;

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

/** Per-speaker state: the Ask button and an open wake window. */
type SpeakerState = {
  pressed: boolean;
  /** When the button was released, while the grace runs. */
  releasedAt: number | null;
  /** When a bare wake word's window closes. */
  windowUntil: number | null;
  cancelTimer: ReturnType<typeof setTimeout> | null;
};

/** What the tracker needs from outside. */
export type AddressingOptions = {
  wakeNames: readonly string[];
  /** The clock in milliseconds. Tests only. */
  now?: () => number;
  /** A press ended with nothing said. */
  onAskCancelled?: (identity: string) => void;
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
  private readonly speakers = new Map<string, SpeakerState>();

  constructor(options: AddressingOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
  }

  private state(identity: string): SpeakerState {
    let state = this.speakers.get(identity);
    if (!state) {
      state = {
        pressed: false,
        releasedAt: null,
        windowUntil: null,
        cancelTimer: null,
      };
      this.speakers.set(identity, state);
    }
    return state;
  }

  /**
   * Records the Ask button being pressed or released.
   *
   * @param identity - Who pressed it.
   * @param pressed - True on press, false on release.
   */
  setPressed(identity: string, pressed: boolean): void {
    const state = this.state(identity);
    if (state.cancelTimer) clearTimeout(state.cancelTimer);
    state.cancelTimer = null;
    if (pressed) {
      state.pressed = true;
      state.releasedAt = null;
      return;
    }
    if (!state.pressed) return;
    state.pressed = false;
    state.releasedAt = this.now();
    state.cancelTimer = setTimeout(() => {
      state.cancelTimer = null;
      if (state.releasedAt === null) return;
      state.releasedAt = null;
      this.options.onAskCancelled?.(identity);
    }, ASK_RELEASE_GRACE_MS);
  }

  /** Whether the person is holding the Ask button right now. */
  isPressed(identity: string): boolean {
    return this.speakers.get(identity)?.pressed ?? false;
  }

  /**
   * Whether an utterance that just ended was spoken under the Ask button:
   * during the press, or within the grace after release.
   *
   * @param identity - The speaker.
   */
  private takeAsk(identity: string): boolean {
    const state = this.speakers.get(identity);
    if (!state) return false;
    if (state.pressed) return true;
    if (
      state.releasedAt !== null &&
      this.now() - state.releasedAt <= ASK_RELEASE_GRACE_MS
    ) {
      state.releasedAt = null;
      if (state.cancelTimer) clearTimeout(state.cancelTimer);
      state.cancelTimer = null;
      return true;
    }
    return false;
  }

  /**
   * Classifies a finished utterance's transcript.
   *
   * @param identity - The speaker, or null when unknown.
   * @param text - The final transcript.
   * @param askedWithButton - Whether the utterance was spoken under the Ask
   *                          button; see {@link Addressing.markAsk}.
   */
  classify(
    identity: string | null,
    text: string,
    askedWithButton = false,
  ): AddressDecision {
    const match = matchWake(text, this.options.wakeNames);
    if (askedWithButton) return { addressed: true, wakeOnly: false };
    if (!identity) return { addressed: match === "addressed", wakeOnly: false };

    const state = this.state(identity);
    const at = this.now();
    if (match === "wake-only") {
      state.windowUntil = at + WAKE_WINDOW_MS;
      return { addressed: true, wakeOnly: true };
    }
    if (state.windowUntil !== null && at <= state.windowUntil) {
      state.windowUntil = null;
      return { addressed: true, wakeOnly: false };
    }
    state.windowUntil = null;
    return { addressed: match === "addressed", wakeOnly: false };
  }

  /**
   * Called when an utterance ends, before it is transcribed: says whether it
   * was spoken under the Ask button, and uses up a post-release grace.
   *
   * @param identity - The speaker.
   */
  markAsk(identity: string): boolean {
    return this.takeAsk(identity);
  }

  /** Cancels every timer. */
  close(): void {
    for (const state of this.speakers.values()) {
      if (state.cancelTimer) clearTimeout(state.cancelTimer);
      state.cancelTimer = null;
    }
  }
}
