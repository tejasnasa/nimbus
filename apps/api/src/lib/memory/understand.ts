/**
 * @module api/lib/memory/understand
 * @description Reads a chat message without calling a model: resolves the
 * dates it names against `now()` in the sender's timezone, decides whether it
 * points at the workspace's own past (earlier chats with the bot, earlier
 * meetings), and reduces the rest to search keywords. The result feeds
 * `recall`.
 *
 * Date handling is deliberately strict. A bare weekday ("Tuesday") and a day
 * with a month ("3 November") resolve to the occurrence that already happened,
 * "last week" is the previous Monday-to-Monday range, and relative day words
 * ("yesterday", "today") are accepted only where the parser is certain of the
 * day. Anything vaguer ("in the morning", "next month") is ignored rather
 * than guessed.
 *
 * @important A date alone never makes {@link Understanding.refersToPast} true.
 *            "What did Apple ship on Monday?" names a past day but asks about
 *            the world, so only phrasing about the workspace's own past
 *            ("you said", "we decided", "in the meeting") counts. Otherwise
 *            the bot would claim to have no record of things it was never
 *            part of.
 *
 * @important Day ranges are built in the sender's timezone. The same instant
 *            is a different calendar day in Asia/Kolkata and in UTC.
 */
import { TZDate } from "@date-fns/tz";
import { addDays, startOfDay, startOfWeek, subDays, subYears } from "date-fns";
import * as chrono from "chrono-node";
import { formatInZone } from "../time/dates";

/** A resolved span of calendar time named in a message. */
export interface DateRange {
  /** The words the user wrote, e.g. "last Tuesday". */
  text: string;
  /** Inclusive start, UTC ISO. */
  startIso: string;
  /** Exclusive end, UTC ISO. */
  endIso: string;
  /** The calendar day in the user's timezone, YYYY-MM-DD (first day for a week). */
  label: string;
  /** A single day, or a whole Monday-to-Monday week. */
  kind: "day" | "week";
}

/** What a message asks about, as far as can be told without a model. */
export interface Understanding {
  ranges: DateRange[];
  keywords: string[];
  /** `websearch_to_tsquery` text built from the keywords, or null when none are left. */
  searchQuery: string | null;
  /** True when the message points at an earlier chat or meeting of this workspace. */
  refersToPast: boolean;
  /** True when the message is about a meeting or call, not only about chat. */
  refersToMeeting: boolean;
  /** True when the message asks whether something still holds or has changed. */
  asksAboutChange: boolean;
}

/**
 * Phrasing that points at the workspace's own past: earlier conversations with
 * the bot, and earlier meetings. A past event in the world does not match.
 */
const PAST_PHRASES =
  /\b(i asked|did i ask|i told|you said|did you say|you told|you answered|you recommended|we discussed|did we discuss|we talked|did we talk|we decided|did we decide|we agreed|did we agree|on the call|in the meeting|in that meeting|meeting on|call on|still the plan|since then|last time|back then|action items from|what happened|what did we (do|cover|work on))\b|\bstill (correct|true|right|accurate|valid)\b/i;

/** Wording that says the question is about a meeting rather than the chat. */
const MEETING_WORDS =
  /\b(meeting|meetings|call|calls|standup|sync|decide|decided|decision|decisions|agreed|action items?)\b/i;

/** Wording that asks whether an earlier answer or decision still stands. */
const CHANGE_PHRASES =
  /\bstill (the plan|correct|true|right|accurate|valid|on|stands?)\b|\bsince then\b|\bany (change|changes|update|updates)\b|\bchanged\b/i;

const STOPWORDS = new Set(
  (
    "a an and are as at be been but by can could did do does for from had has have how i if in into is it its " +
    "me my of on or our so than that the their them then there these they this to us was we were what when " +
    "where which who why will with would you your about any anything ask asked again answer answered " +
    "changed change today since still correct tell said say last ago week weeks day days month months year " +
    "years monday tuesday wednesday thursday friday saturday sunday january february march april may june " +
    "july august september october november december jan feb mar apr jun jul aug sep sept oct nov dec " +
    "yesterday tomorrow earlier before previously discussed shipped new big something some one two three " +
    "four five six seven eight nine ten please also just really very much more most " +
    "meeting meetings call calls nimbusbot nimbus bot decide decided decision decisions agree agreed " +
    "discuss talked happened happen plan action items item notes recap whether"
  ).split(" "),
);

/** The calendar day of an instant in a zone as YYYY-MM-DD. */
function formatDay(instant: Date, tz: string): string {
  return formatInZone(instant, tz, "yyyy-MM-dd");
}

function dayRange(instant: Date, tz: string, text: string): DateRange {
  const start = startOfDay(new TZDate(instant.getTime(), tz));
  const end = addDays(start, 1);
  return {
    text,
    startIso: new Date(start.getTime()).toISOString(),
    endIso: new Date(end.getTime()).toISOString(),
    label: formatDay(new Date(start.getTime()), tz),
    kind: "day",
  };
}

/**
 * Chrono resolves a bare "Monday" or "3 November" to whichever occurrence is
 * nearest, which can be next week or next year. People who say these when
 * asking what was discussed mean the one that already happened, so a future
 * result moves back by a week (weekday only) or a year (a day and month).
 *
 * @param date - The date chrono resolved.
 * @param now - The current time.
 * @param kind - "weekday" for a bare weekday, "date" for a day and month.
 * @returns `date` when it is not in the future, else the previous occurrence.
 */
export function applyPastBias(
  date: Date,
  now: Date,
  kind: "weekday" | "date",
): Date {
  if (date.getTime() <= now.getTime()) return date;
  return kind === "weekday" ? subDays(date, 7) : subYears(date, 1);
}

/**
 * Splits text into searchable lowercase words, dropping stopwords and short
 * tokens. Shared by keyword extraction and by the topic overlap check.
 *
 * @param text - Free text.
 * @returns Distinct significant words in order of first appearance.
 */
export function significantWords(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9+#.]+/)
        .map((w) => w.replace(/^[.]+|[.]+$/g, ""))
        .filter((w) => w.length >= 3 && !STOPWORDS.has(w)),
    ),
  ];
}

/**
 * Pulls dates, intent and keywords out of a message without calling a model.
 *
 * @param message - The user's message.
 * @param now - The current time, from `now()`.
 * @param tz - The user's IANA timezone.
 * @returns The resolved ranges, keywords and intent flags.
 */
export function understand(
  message: string,
  now: Date,
  tz: string,
): Understanding {
  const parsed = chrono.parse(
    message,
    { instant: now, timezone: tz },
    { forwardDate: false },
  );
  const nowLocal = new TZDate(now.getTime(), tz);
  const ranges: DateRange[] = [];
  const consumed: string[] = [];

  for (const result of parsed) {
    const text = result.text;
    consumed.push(text);

    if (/\blast week\b/i.test(text)) {
      const thisMonday = startOfWeek(nowLocal, { weekStartsOn: 1 });
      const start = subDays(thisMonday, 7);
      ranges.push({
        text,
        startIso: new Date(start.getTime()).toISOString(),
        endIso: new Date(thisMonday.getTime()).toISOString(),
        label: formatDay(new Date(start.getTime()), tz),
        kind: "week",
      });
      continue;
    }

    const weekdayOnly =
      result.start.isCertain("weekday") &&
      !result.start.isCertain("day") &&
      !result.start.isCertain("month");
    const monthAndDay =
      result.start.isCertain("day") && result.start.isCertain("month");
    if (!weekdayOnly && !monthAndDay) continue;

    let instant = result.start.date();
    if (weekdayOnly) {
      instant = applyPastBias(instant, now, "weekday");
    } else if (!result.start.isCertain("year")) {
      instant = applyPastBias(instant, now, "date");
    }
    ranges.push(dayRange(instant, tz, text));
  }

  let remainder = message.toLowerCase();
  for (const text of consumed) {
    remainder = remainder.replace(text.toLowerCase(), " ");
  }
  const keywords = significantWords(remainder);

  return {
    ranges,
    keywords,
    searchQuery: keywords.length ? keywords.join(" or ") : null,
    refersToPast: PAST_PHRASES.test(message),
    refersToMeeting: MEETING_WORDS.test(message),
    asksAboutChange: CHANGE_PHRASES.test(message),
  };
}
