/**
 * @module api/__tests__/unit/textToolCalls
 * @description Recovering tool calls a model wrote into its text, stripping
 * that markup from replies, and the streaming guard that stops at it. The DSML
 * sample is the markup a DeepSeek model read aloud in a real call.
 */
import { describe, expect, it } from "vitest";
import {
  hasToolMarkup,
  markupGuard,
  stripToolMarkup,
  toolCallsFromText,
} from "../../lib/ai/textToolCalls";

const DSML_SPOKEN = `<｜｜DSML｜｜ calls>
<｜｜DSML｜｜ invoke name="create_action_item">
<｜｜DSML｜｜ parameter name="title" string="true">Pick a dinner spot near Saket</｜｜DSML｜｜ parameter>
<｜｜DSML｜｜ parameter name="assignee" string="true">Tejas</｜｜DSML｜｜ parameter>
<｜｜DSML｜｜ parameter name="due_date" string="true">2026-11-23</｜｜DSML｜｜ parameter>
</｜｜DSML｜｜ invoke>
<｜｜DSML｜｜ invoke name="search_meetings">
<｜｜DSML｜｜ parameter name="query" string="true">Saket showtimes</｜｜DSML｜｜ parameter>
<｜｜DSML｜｜ parameter name="since_days" string="false">2</｜｜DSML｜｜ parameter>
</｜｜DSML｜｜ invoke>
</｜｜DSML｜｜ calls>`;

const DSML_CANONICAL = `<｜DSML｜function_calls>
<｜DSML｜invoke name="list_meetings">
<｜DSML｜parameter name="since_days" string="false">null</｜DSML｜parameter>
</｜DSML｜invoke>
</｜DSML｜function_calls>`;

const LEGACY = `<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>function<｜tool▁sep｜>get_transcript
\`\`\`json
{"meeting_id": "m1"}
\`\`\`<｜tool▁call▁end｜><｜tool▁calls▁end｜>`;

describe("toolCallsFromText", () => {
  it("recovers DSML calls as it was spoken, with JSON for non-string parameters", () => {
    const calls = toolCallsFromText(DSML_SPOKEN);
    expect(calls.map((c) => c.name)).toEqual([
      "create_action_item",
      "search_meetings",
    ]);
    expect(JSON.parse(calls[0]!.arguments)).toEqual({
      title: "Pick a dinner spot near Saket",
      assignee: "Tejas",
      due_date: "2026-11-23",
    });
    expect(JSON.parse(calls[1]!.arguments)).toEqual({
      query: "Saket showtimes",
      since_days: 2,
    });
    expect(calls[0]!.type).toBe("function_call");
    expect(calls[0]!.call_id).not.toBe(calls[1]!.call_id);
  });

  it("recovers the canonical single-bar DSML form", () => {
    const [only] = toolCallsFromText(DSML_CANONICAL);
    expect(only?.name).toBe("list_meetings");
    expect(JSON.parse(only!.arguments)).toEqual({ since_days: null });
  });

  it("recovers the older tool-call tokens", () => {
    const [only] = toolCallsFromText(LEGACY);
    expect(only?.name).toBe("get_transcript");
    expect(JSON.parse(only!.arguments)).toEqual({ meeting_id: "m1" });
  });

  it("keeps a non-string parameter that is not JSON as text", () => {
    const text = `<｜DSML｜invoke name="t"><｜DSML｜parameter name="n" string="false">soon</｜DSML｜parameter></｜DSML｜invoke>`;
    expect(JSON.parse(toolCallsFromText(text)[0]!.arguments)).toEqual({
      n: "soon",
    });
  });

  it("finds nothing in ordinary text, including text with angle brackets", () => {
    expect(toolCallsFromText("Book seats for 4:30 <after lunch>.")).toEqual([]);
    expect(hasToolMarkup("a < b and c > d")).toBe(false);
  });
});

describe("stripToolMarkup", () => {
  it("keeps the prose before the markup and drops the rest", () => {
    expect(stripToolMarkup(`On it, Tejas. ${DSML_SPOKEN}`)).toBe(
      "On it, Tejas.",
    );
  });

  it("leaves nothing when the reply is only markup", () => {
    expect(stripToolMarkup(DSML_SPOKEN)).toBe("");
    expect(stripToolMarkup(LEGACY)).toBe("");
  });

  it("leaves ordinary text alone", () => {
    expect(stripToolMarkup("  Saket at 1:40.  ")).toBe("Saket at 1:40.");
  });
});

describe("markupGuard", () => {
  const stream = (deltas: string[]) => {
    const out: string[] = [];
    const guard = markupGuard((t) => out.push(t));
    deltas.forEach(guard.push);
    guard.flush();
    return out.join("");
  };

  it("passes ordinary text through unchanged", () => {
    expect(stream(["Go with ", "Saket. ", "It is a < b trip."])).toBe(
      "Go with Saket. It is a < b trip.",
    );
  });

  it("stops where markup starts, even when a tag is split across deltas", () => {
    expect(
      stream(["Sure. <", "｜｜DS", 'ML｜｜ invoke name="x">', "more"]),
    ).toBe("Sure. ");
  });

  it("passes text on as it arrives rather than at the end", () => {
    const out: string[] = [];
    const guard = markupGuard((t) => out.push(t));
    guard.push("First sentence. ");
    expect(out.join("")).toBe("First sentence. ");
    guard.push("Then <｜DSML｜invoke");
    guard.push(" more");
    guard.flush();
    expect(out.join("")).toBe("First sentence. Then ");
  });
});
