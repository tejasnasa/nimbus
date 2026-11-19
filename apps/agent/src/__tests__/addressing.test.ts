/**
 * @module agent/__tests__/addressing
 * @description Which utterances are spoken to the assistant: the wake phrase
 * table (positives, mentions that are not requests, mishearings), the window a
 * bare wake word opens.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  Addressing,
  matchWake,
  normalise,
  WAKE_WINDOW_MS,
} from "../addressing.js";

const WAKE = ["nimbus", "nimbus bot", "nimbusbot"];

describe("matchWake", () => {
  it.each([
    "Nimbus, what did we decide about auth?",
    "nimbus what did we decide about auth",
    "NimbusBot, summarise the last ten minutes.",
    "Nimbus bot, who owns the rollout?",
    "Hey Nimbus, add an action item for Priya.",
    "Okay so Nimbus, when is the launch?",
    "What do you think, Nimbus?",
    "Nimbus can you draw this discussion",
    "Nimbus? Are you there",
    "Mimbus, what time is it?",
    "Nimbas what did Sam say",
    "Limbus, read back the decisions.",
    "Nimbus",
  ])("addresses %j", (text) => {
    expect(matchWake(text, WAKE)).not.toBe("none");
  });

  it.each([
    "Nimbus is the product name.",
    "nimbus was down this morning",
    "Nimbus has a canvas feature",
    "Nimbus can handle that load",
    "I think nimbus should ship on Friday",
    "We demoed Nimbus to the client and they liked it",
    "The nimbuses over the hills were dark",
    "Let us go to limbo for a while",
    "Nimbus's roadmap is public",
    "",
  ])("does not address %j", (text) => {
    expect(matchWake(text, WAKE)).toBe("none");
  });

  it.each(["Nimbus?", "Hey Nimbus.", "nimbus bot!", "OK, NimbusBot?"])(
    "treats a bare wake word %j as wake-only",
    (text) => {
      expect(matchWake(text, WAKE)).toBe("wake-only");
    },
  );

  it("folds names and keeps only commas and question marks", () => {
    expect(normalise("Hey, Nimbus Bot! What's up?", WAKE)).toBe(
      "hey, nimbus whats up?",
    );
    expect(normalise("NIMBUS-BOT: go", WAKE)).toBe("nimbus go");
  });

  it("uses the redeemed wake names", () => {
    expect(matchWake("Cumulus, what did we decide?", ["cumulus"])).toBe(
      "addressed",
    );
  });
});

describe("Addressing", () => {
  let now = 0;
  const make = () => new Addressing({ wakeNames: WAKE, now: () => now });

  beforeEach(() => {
    now = 1_000_000;
  });

  it("opens a window after a bare wake word for that speaker only", () => {
    const addressing = make();
    expect(addressing.classify("riya", "Nimbus?")).toEqual({
      addressed: true,
      wakeOnly: true,
    });
    now += 3000;
    expect(addressing.classify("sam", "what about the budget")).toEqual({
      addressed: false,
      wakeOnly: false,
    });
    expect(addressing.classify("riya", "what about the budget")).toEqual({
      addressed: true,
      wakeOnly: false,
    });
    // The window is used up by one utterance.
    expect(addressing.classify("riya", "and the timeline").addressed).toBe(
      false,
    );
  });

  it("closes the window after six seconds", () => {
    const addressing = make();
    addressing.classify("riya", "Hey Nimbus");
    now += WAKE_WINDOW_MS + 1;
    expect(addressing.classify("riya", "what about the budget").addressed).toBe(
      false,
    );
  });

  it("addresses an unknown speaker only by wake phrase", () => {
    const addressing = make();
    expect(addressing.classify(null, "Nimbus, hello").addressed).toBe(true);
    expect(addressing.classify(null, "Nimbus?").wakeOnly).toBe(false);
  });
});
