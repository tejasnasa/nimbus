/**
 * @module web/lib/parseUserAgent
 * @description Pure User-Agent string → coarse "Chrome on macOS"-style label
 * + device type, for the active-sessions list. Backed by `ua-parser-js`
 * (`UAParser` class export). A nullish or unparseable UA produces a generic
 * "Unknown browser on Unknown OS" label rather than throwing, since every
 * column on the `Session` model (`userAgent`, `ipAddress`) is nullable.
 *
 * Lives in `apps/web/lib` rather than `packages/utils` because only the
 * browser needs UA parsing, and the shared package would pull the regex
 * database into the API build unnecessarily.
 */
import { UAParser } from "ua-parser-js";

/** Result of parsing a User-Agent string into a renderable label + category. */
export type ParsedUserAgent = {
  /** Browser family (e.g. "Chrome", "Firefox"); null when unparseable. */
  browser: string | null;
  /** Operating system family (e.g. "macOS", "Windows"); null when unparseable. */
  os: string | null;
  /** Coarse device category from ua-parser-js. */
  deviceType: "mobile" | "tablet" | "console" | "wearable" | "embedded" | "xr" | "smarttv" | "desktop" | null;
};

/**
 * Parse a User-Agent string into a renderable form. Tolerates the three
 * failure modes the `Session.userAgent` column allows (`null`,
 * `undefined`, empty string) and any unrecognised UA without throwing.
 *
 * @param userAgent - The raw User-Agent header value, or nullish.
 * @returns Parsed browser/OS/device, each field null when unavailable.
 */
export function parseUserAgent(userAgent: string | null | undefined): ParsedUserAgent {
  if (!userAgent) {
    return { browser: null, os: null, deviceType: null };
  }
  const result = new UAParser(userAgent).getResult();
  return {
    browser: result.browser.name ?? null,
    os: result.os.name ?? null,
    deviceType: (result.device.type as ParsedUserAgent["deviceType"]) ?? null,
  };
}

/**
 * Build the row label shown next to an active session. Falls back to a
 * generic phrase whenever either component is unknown, since
 * `"Chrome on "` looks worse than `"Unknown browser on macOS"`.
 *
 * @param userAgent - The raw User-Agent string, or nullish.
 * @returns A short label such as "Chrome on macOS" or "Unknown browser".
 */
export function describeUserAgent(userAgent: string | null | undefined): string {
  const { browser, os } = parseUserAgent(userAgent);
  if (browser && os) return `${browser} on ${os}`;
  if (browser) return browser;
  if (os) return `Unknown browser on ${os}`;
  return "Unknown browser";
}
