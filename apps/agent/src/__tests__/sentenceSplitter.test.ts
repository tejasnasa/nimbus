/**
 * @module agent/__tests__/sentenceSplitter
 * @description Cutting streamed text into sentences: numbers, abbreviations,
 * overlong sentences, and deltas that split words and punctuation anywhere.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_SENTENCE_CHARS,
  SentenceSplitter,
  sentences,
} from "../tts/sentenceSplitter.js";

/** Feeds the text one delta at a time and collects every sentence. */
function split(deltas: string[]): string[] {
  const splitter = new SentenceSplitter();
  const out = deltas.flatMap((delta) => splitter.push(delta));
  return [...out, ...splitter.flush()];
}

describe("SentenceSplitter", () => {
  it("cuts at full stops, question marks and exclamation marks", () => {
    expect(split(["We ship Friday. Is that okay? Great!"])).toEqual([
      "We ship Friday.",
      "Is that okay?",
      "Great!",
    ]);
  });

  it("does not cut inside numbers", () => {
    expect(split(["Version 3.5 is out. It costs 1.25 dollars."])).toEqual([
      "Version 3.5 is out.",
      "It costs 1.25 dollars.",
    ]);
  });

  it("does not cut after abbreviations", () => {
    expect(
      split(["Use a tool, e.g. Excalidraw, for that. Dr. Shah agreed."]),
    ).toEqual(["Use a tool, e.g. Excalidraw, for that.", "Dr. Shah agreed."]);
  });

  it("keeps closing quotes and repeated marks with the sentence", () => {
    expect(split(['She said "ship it." Really?! Yes.'])).toEqual([
      'She said "ship it."',
      "Really?!",
      "Yes.",
    ]);
  });

  it("waits for the character after a terminator before cutting", () => {
    const splitter = new SentenceSplitter();
    expect(splitter.push("It is 3.")).toEqual([]);
    expect(splitter.push("5 now. Next")).toEqual(["It is 3.5 now."]);
    expect(splitter.flush()).toEqual(["Next"]);
    expect(splitter.flush()).toEqual([]);
  });

  it("handles deltas split mid-word and mid-number", () => {
    const text = "The budget is 4.5 thousand. Priya owns it. Done";
    const deltas = text.match(/.{1,3}/g)!;
    expect(split(deltas)).toEqual([
      "The budget is 4.5 thousand.",
      "Priya owns it.",
      "Done",
    ]);
  });

  it("cuts an overlong sentence at a space before the limit", () => {
    const words = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    const out = split([words]);
    expect(out.length).toBeGreaterThan(1);
    for (const sentence of out) {
      expect(sentence.length).toBeLessThanOrEqual(MAX_SENTENCE_CHARS);
    }
    expect(out.join(" ")).toBe(words);
  });

  it("hard-cuts an overlong run with no spaces", () => {
    const out = split(["x".repeat(MAX_SENTENCE_CHARS + 40)]);
    expect(out[0]).toHaveLength(MAX_SENTENCE_CHARS);
    expect(out[1]).toHaveLength(40);
  });

  it("skips empty pieces", () => {
    expect(split(["  ", ". ", "Hi."])).toEqual([".", "Hi."]);
  });
});

describe("sentences", () => {
  it("turns a stream of deltas into a stream of sentences", async () => {
    async function* deltas() {
      yield "Hello th";
      yield "ere. How are";
      yield " you?";
    }
    const out: string[] = [];
    for await (const sentence of sentences(deltas())) out.push(sentence);
    expect(out).toEqual(["Hello there.", "How are you?"]);
  });
});
