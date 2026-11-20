/**
 * @module api/__tests__/unit/botMention
 * @description The shared mention matcher: the new `@nimbus` spelling and the
 * original `@nimbusbot` both address the assistant, case-insensitively, and a
 * longer handle that merely starts with the name does not.
 */
import { describe, expect, it } from "vitest";
import { BOT_MENTION, mentionsBot } from "@nimbus/types";

describe("mentionsBot", () => {
  it.each([
    "@nimbus hello",
    "@nimbusbot hello",
    "@NimbusBot hello",
    "@NIMBUS hello",
    "hey @nimbus, what changed?",
    "thanks @nimbusbot!",
    "@nimbus",
    "ping\n@nimbus",
  ])("triggers on %j", (text) => {
    expect(mentionsBot(text)).toBe(true);
  });

  it.each([
    "@nimbusapp hello",
    "@nimbuses hello",
    "@nimbusbots hello",
    "@nimbus_team hello",
    "nimbus without an at sign",
    "mail me at nimbus@example.com later",
    "",
  ])("does not trigger on %j", (text) => {
    expect(mentionsBot(text)).toBe(false);
  });

  it("is stateless across repeated calls", () => {
    expect(BOT_MENTION.global).toBe(false);
    expect(mentionsBot("@nimbus")).toBe(true);
    expect(mentionsBot("@nimbus")).toBe(true);
  });
});
