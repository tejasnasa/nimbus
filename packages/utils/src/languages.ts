/**
 * @module utils/languages
 * @description The languages a viewer can read live captions in.
 *
 * @important Codes are ISO-639-1 and are the only values stored in
 *            `SegmentTranslation.language`, sent over `meeting:caption-language`
 *            and accepted by `?language=`. Adding a language here is all it takes
 *            for the picker and the server-side validation to offer it.
 */

/** A caption language. */
export type CaptionLanguage = {
  /** ISO-639-1 code. */
  code: string;
  /** Name shown in the picker, in English. */
  label: string;
};

/** Every language captions can be translated into. */
export const CAPTION_LANGUAGES: readonly CaptionLanguage[] = [
  { code: "en", label: "English" },
  { code: "hi", label: "Hindi" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "pt", label: "Portuguese" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "zh", label: "Chinese" },
  { code: "ar", label: "Arabic" },
  { code: "ru", label: "Russian" },
  { code: "it", label: "Italian" },
  { code: "nl", label: "Dutch" },
  { code: "tr", label: "Turkish" },
  { code: "id", label: "Indonesian" },
  { code: "bn", label: "Bengali" },
  { code: "ta", label: "Tamil" },
  { code: "te", label: "Telugu" },
  { code: "mr", label: "Marathi" },
  { code: "ur", label: "Urdu" },
];

const BY_CODE = new Map(CAPTION_LANGUAGES.map((l) => [l.code, l]));

/**
 * Whether `code` is a supported caption language.
 *
 * @param code - Any value; non-strings are never supported.
 */
export function isCaptionLanguage(code: unknown): code is string {
  return typeof code === "string" && BY_CODE.has(code);
}

/**
 * The picker label of a supported language.
 *
 * @param code - A language code.
 * @returns The label, or the code itself when it is not supported.
 */
export function captionLanguageLabel(code: string): string {
  return BY_CODE.get(code)?.label ?? code;
}

/**
 * Reduces whatever a transcriber reported (`en`, `en-US`, `English`) to a
 * supported code.
 *
 * @param reported - The reported language, if any.
 * @returns The supported code, or null when it is absent or not recognised.
 */
export function normalizeCaptionLanguage(
  reported: string | null | undefined,
): string | null {
  if (!reported) return null;
  const lowered = reported.trim().toLowerCase();
  const primary = lowered.split(/[-_]/)[0] ?? "";
  if (BY_CODE.has(primary)) return primary;
  const byName = CAPTION_LANGUAGES.find(
    (l) => l.label.toLowerCase() === lowered,
  );
  return byName?.code ?? null;
}
