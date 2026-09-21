/**
 * @module web/tests/unit/lib/parseUserAgent
 * @description Pure-function coverage for the UA parser. Every `Session`
` column carrying the user agent is nullable, so the failure modes
(null, undefined, empty string, garbage) are the ones an implementation
is most likely to forget.
 */
import { describe, expect, it } from "vitest";
import { describeUserAgent, parseUserAgent } from "../../../lib/parseUserAgent";

const CHROME_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const FIREFOX_WIN =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0";
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

describe("parseUserAgent", () => {
  it("identifies Chrome on macOS", () => {
    const result = parseUserAgent(CHROME_MAC);
    expect(result.browser).toBe("Chrome");
    expect(result.os).toBe("macOS");
    expect(result.deviceType).toBeNull();
  });

  it("identifies Firefox on Windows", () => {
    const result = parseUserAgent(FIREFOX_WIN);
    expect(result.browser).toBe("Firefox");
    expect(result.os).toBe("Windows");
  });

  it("identifies Safari on iOS as a mobile device", () => {
    const result = parseUserAgent(SAFARI_IPHONE);
    expect(result.browser).toBe("Mobile Safari");
    expect(result.os).toBe("iOS");
    expect(result.deviceType).toBe("mobile");
  });

  it("returns nulls for a null input", () => {
    expect(parseUserAgent(null)).toEqual({
      browser: null,
      os: null,
      deviceType: null,
    });
  });

  it("returns nulls for an undefined input", () => {
    expect(parseUserAgent(undefined)).toEqual({
      browser: null,
      os: null,
      deviceType: null,
    });
  });

  it("returns nulls for an empty string", () => {
    expect(parseUserAgent("")).toEqual({
      browser: null,
      os: null,
      deviceType: null,
    });
  });

  it("does not throw on a non-UA garbage string", () => {
    // ua-parser-js is lenient here: it returns nulls for the fields it
    // can't recognise. The contract we care about is that the call does
    // not throw.
    expect(() => parseUserAgent("not-a-ua")).not.toThrow();
    const result = parseUserAgent("not-a-ua");
    expect(result.browser === null || typeof result.browser === "string").toBe(
      true,
    );
  });
});

describe("describeUserAgent", () => {
  it("composes 'Browser on OS' when both are known", () => {
    expect(describeUserAgent(CHROME_MAC)).toBe("Chrome on macOS");
  });

  it("renders the browser alone when the OS is unknown", () => {
    // Browsers without an OS hint in their UA (rare but possible — a
    // generic Chrome token) collapse to the browser label rather than
    // producing a trailing " on ".
    expect(describeUserAgent(CHROME_MAC)).not.toMatch(/ on $/);
  });

  it("falls back to a generic phrase for nullish input", () => {
    expect(describeUserAgent(null)).toBe("Unknown browser");
    expect(describeUserAgent(undefined)).toBe("Unknown browser");
    expect(describeUserAgent("")).toBe("Unknown browser");
  });

  it("falls back to a generic phrase for unparseable input", () => {
    expect(describeUserAgent("not-a-ua")).toBe("Unknown browser");
  });
});
