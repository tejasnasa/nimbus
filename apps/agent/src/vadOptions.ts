/**
 * @module agent/vadOptions
 * @description The voice activity detector's settings, in one place so the
 * worker and the tests load the model identically.
 *
 * @important The Silero plugin takes its durations in milliseconds, not
 *            seconds. A seconds-style value (0.6) is accepted without error and
 *            silently means "no minimum", which splits every sentence at each
 *            pause for breath. The utterance buffer's defaults (`minSpeechMs`,
 *            `prefixMs`, `minSilenceMs`) mirror these and must change with them.
 */

/** Settings handed to `silero.VAD.load`. */
export const VAD_OPTIONS = {
  minSpeechDuration: 250,
  minSilenceDuration: 600,
  prefixPaddingDuration: 300,
  activationThreshold: 0.5,
  sampleRate: 16_000 as const,
};
