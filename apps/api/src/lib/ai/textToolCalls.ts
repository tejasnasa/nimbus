/**
 * @module api/lib/ai/textToolCalls
 * @description Recovers tool calls that a model wrote into its text instead of
 * returning them as `function_call` items, and strips that markup from text a
 * person will read or hear.
 *
 * DeepSeek's models emit tool calls in their own markup, which the provider is
 * meant to parse into structured calls. Now and then the markup comes back as
 * plain output text instead: no call is made, and the raw markup would be shown
 * in chat or read aloud in a call. Two forms are recognised:
 *
 * - DSML: `<｜DSML｜invoke name="tool">` blocks holding
 *   `<｜DSML｜parameter name="p" string="true|false">value</｜DSML｜parameter>`,
 *   where `string="false"` marks a JSON value. The bars are full-width and may
 *   be doubled, and the tags may carry spaces.
 * - The older tool-call tokens:
 *   `<｜tool▁call▁begin｜>function<｜tool▁sep｜>name` followed by JSON arguments
 *   and `<｜tool▁call▁end｜>`.
 *
 * @important Recovered calls get fresh `call_id`s and are replayed to the model
 *            as `function_call` input items in place of the text that carried
 *            them, so the markup never re-enters the conversation as an example.
 */
import { randomUUID } from "node:crypto";

/** A tool call recovered from text, shaped like a Responses API `function_call` item. */
export type TextToolCall = {
  type: "function_call";
  call_id: string;
  name: string;
  /** The arguments as a JSON object string. */
  arguments: string;
};

/** One bar of a special token: ASCII `|` or the full-width `｜`. */
const BAR = "[|｜]+";
const DSML_OPEN = `<${BAR}\\s*DSML\\s*${BAR}\\s*`;
const DSML_CLOSE = `<\\/${BAR}\\s*DSML\\s*${BAR}\\s*`;

const DSML_INVOKE = new RegExp(
  `${DSML_OPEN}invoke\\s+name="([^"]+)"\\s*>([\\s\\S]*?)${DSML_CLOSE}invoke\\s*>`,
  "g",
);
const DSML_PARAMETER = new RegExp(
  `${DSML_OPEN}parameter\\s+name="([^"]+)"(?:\\s+string="(true|false)")?\\s*>([\\s\\S]*?)${DSML_CLOSE}parameter\\s*>`,
  "g",
);
const LEGACY_CALL =
  /<[|｜]tool▁call▁begin[|｜]>\s*(?:function)?\s*<[|｜]tool▁sep[|｜]>\s*([\w.-]+)\s*(?:```(?:json)?)?\s*([\s\S]*?)\s*(?:```)?\s*<[|｜]tool▁call▁end[|｜]>/g;

/** Where tool markup starts: a DSML tag or a tool-call token. */
const MARKUP_START = new RegExp(`<\\/?${BAR}\\s*(?:DSML|tool▁)`);

/**
 * Whether text holds tool-call markup.
 *
 * @param text - Model output text.
 */
export function hasToolMarkup(text: string): boolean {
  return MARKUP_START.test(text);
}

/** Reads a DSML parameter value: JSON when marked non-string, else the raw text. */
function parameterValue(raw: string, isString: string | undefined): unknown {
  if (isString !== "false") return raw;
  try {
    return JSON.parse(raw.trim());
  } catch {
    return raw;
  }
}

/**
 * Recovers the tool calls written into text.
 *
 * @param text - Model output text.
 * @returns The calls in order, empty when the text holds none that parse.
 */
export function toolCallsFromText(text: string): TextToolCall[] {
  if (!hasToolMarkup(text)) return [];
  const calls: TextToolCall[] = [];

  for (const [, name = "", body = ""] of text.matchAll(DSML_INVOKE)) {
    const args: Record<string, unknown> = {};
    for (const [, key = "", isString, raw = ""] of body.matchAll(
      DSML_PARAMETER,
    )) {
      args[key] = parameterValue(raw, isString);
    }
    calls.push(call(name, JSON.stringify(args)));
  }

  for (const [, name = "", raw = ""] of text.matchAll(LEGACY_CALL)) {
    try {
      const parsed: unknown = JSON.parse(raw || "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        calls.push(call(name, JSON.stringify(parsed)));
      }
    } catch {
      // Arguments that are not a JSON object cannot be run; skip the call.
    }
  }

  return calls;
}

function call(name: string, args: string): TextToolCall {
  return {
    type: "function_call",
    call_id: `call_text_${randomUUID()}`,
    name: name.trim(),
    arguments: args,
  };
}

/**
 * Removes tool markup from text meant for people. Everything from the first
 * markup tag on is dropped: a reply that breaks into markup does not resume
 * as prose in practice, and half a tag read aloud is worse than a shorter reply.
 *
 * @param text - Model output text.
 * @returns The text before any markup, trimmed.
 */
export function stripToolMarkup(text: string): string {
  const match = MARKUP_START.exec(text);
  return (match ? text.slice(0, match.index) : text).trim();
}

/** Longest stretch after a `<` held back while it might still become a tag. */
const TAG_LOOKAHEAD = 24;

/**
 * Passes streamed text through as it arrives and stops for good where tool
 * markup starts. Text after a late `<` is held until it is clear whether a tag
 * follows, so no part of a tag is ever passed on.
 *
 * @param send - Receives the safe text, in order.
 * @returns `push` for each delta and `flush` once the stream ends.
 */
export function markupGuard(send: (text: string) => void): {
  push: (delta: string) => void;
  flush: () => void;
} {
  let buffer = "";
  let sent = 0;
  let stopped = false;

  const pass = (end: number) => {
    if (end > sent) send(buffer.slice(sent, end));
    sent = Math.max(sent, end);
  };

  return {
    push(delta) {
      if (stopped) return;
      buffer += delta;
      const markup = MARKUP_START.exec(buffer.slice(sent));
      if (markup) {
        pass(sent + markup.index);
        stopped = true;
        return;
      }
      const open = buffer.lastIndexOf("<");
      const holdFrom =
        open >= sent && buffer.length - open <= TAG_LOOKAHEAD
          ? open
          : buffer.length;
      pass(holdFrom);
    },
    flush() {
      if (!stopped) pass(buffer.length);
      stopped = true;
    },
  };
}
