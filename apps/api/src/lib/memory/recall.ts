/**
 * @module api/lib/memory/recall
 * @description Looks up what the workspace already recorded about the past
 * before NimbusBot answers, with plain SQL and no model: meetings whose start
 * falls in a date the user named (with their notes, decisions, open questions
 * and the CURRENT state of their action items), the workspace chat from that
 * period (the bot's replies and the messages that mentioned it first), and
 * keyword matches over transcripts, decisions, action items, meeting titles
 * and chat. Everything lands in one dated text block that `bot.ts` places
 * after the fixed system prompt.
 *
 * Dates win over keywords: when the user named a day, that day's records come
 * first and keywords only order them. Keyword matches stand alone only when no
 * date was named or the named date has no records. When the question asks
 * whether something still holds, decisions and action items from LATER
 * meetings on the same topics are included so the model can answer as
 * then-versus-now.
 *
 * Keyword search over decisions, action items, meeting titles and chat builds
 * its `tsvector` on the fly, filtered to one workspace first. A workspace holds
 * hundreds of such rows, not millions, so a scan of that slice is cheap and
 * avoids a migration and a generated column for each table.
 *
 * @important Every query is scoped to the `workspaceId` argument, so nothing
 *            from another workspace can reach the block. The caller (the chat
 *            handler) has already checked the sender's membership.
 *
 * @important The flags at the top of the block (`NO_MATCHING_HISTORY`,
 *            `NO_HISTORY_ON_REQUESTED_DATE`, `AMBIGUOUS_MATCH`) are instructions
 *            the system prompt tells the model to obey. Their names and the
 *            prompt rules in `bot.ts` must change together.
 *
 * @important Messages in `excludeMessageIds` (the history `bot.ts` already
 *            sends as real conversation turns) are never recalled again.
 */
import { prisma } from "@nimbus/db";
import { MeetingSummarySchema } from "@nimbus/types";
import { searchSegments } from "../meeting/search";
import { formatInZone } from "../time/dates";
import {
  significantWords,
  type DateRange,
  type Understanding,
} from "./understand";

/** Most meetings rendered for one question. */
export const MAX_RECALLED_MEETINGS = 4;

/** Most chat lines rendered for one question. */
export const MAX_CHAT_LINES = 12;

/** Most later decisions or action items added for a then-versus-now answer. */
export const MAX_LATER_ITEMS = 6;

/** Rough token budget for the whole block. */
export const RECALL_TOKEN_BUDGET = 3000;

/** Flags the model is told to act on; see the system prompt. */
export const FLAG_NO_MATCHING_HISTORY = "NO_MATCHING_HISTORY";
export const FLAG_NO_HISTORY_ON_DATE = "NO_HISTORY_ON_REQUESTED_DATE";
export const FLAG_AMBIGUOUS = "AMBIGUOUS_MATCH";

/** Transcript lines shown for a meeting that has no notes yet. */
const EXCERPT_LINES = 6;

/** Keyword meetings used when no date selects any. */
const MAX_KEYWORD_MEETINGS = 3;

/** Keyword chat lines used when no date selects any. */
const MAX_KEYWORD_CHAT = 6;

/** An action item as it stands now. */
export interface RecalledActionItem {
  text: string;
  /** Resolved member name, else the name as spoken, else null. */
  owner: string | null;
  dueDate: Date | null;
  status: "OPEN" | "DONE";
  completedAt: Date | null;
}

/** A meeting with everything the block shows about it. */
export interface RecalledMeeting {
  id: string;
  startedAt: Date;
  endedAt: Date | null;
  status: "LIVE" | "ENDED" | "SUMMARIZED" | "FAILED";
  title: string | null;
  participants: string[];
  /** The notes summary, or null while the notes are not written. */
  summary: string | null;
  openQuestions: string[];
  decisions: string[];
  actionItems: RecalledActionItem[];
  notesDocument: { id: string; title: string } | null;
  /** First transcript lines, kept only when there are no notes. */
  excerpt: Array<{ speaker: string; text: string }>;
  /** How strongly the keywords hit this meeting; 0 for none. */
  score: number;
}

/** One chat message as the block shows it. */
export interface RecalledChatLine {
  id: string;
  at: Date;
  author: string;
  isBot: boolean;
  content: string;
}

/** A decision or action item from a meeting after the recalled ones. */
export interface LaterItem {
  kind: "decision" | "action";
  meetingStartedAt: Date;
  meetingTitle: string | null;
  text: string;
  /** Only for actions: current state, e.g. `OPEN` or `DONE`. */
  state: string | null;
}

/** What {@link recall} found. */
export interface RecallResult {
  meetings: RecalledMeeting[];
  chat: RecalledChatLine[];
  later: LaterItem[];
  flags: string[];
  /** The dated block that goes into the prompt, empty when nothing was recalled. */
  block: string;
}

/** Inputs of {@link recall}. */
export interface RecallOptions {
  /** Messages already sent as real conversation turns; never recalled a second time. */
  excludeMessageIds: Set<string>;
  tz: string;
  /** The current time, from `now()`. */
  now: Date;
  /** NimbusBot's user id, so its messages are labelled as the bot's. */
  botUserId?: string;
  tokenBudget?: number;
}

/** Text that can be rendered in full or, when space is short, compactly. */
interface Renderable {
  full: string;
  compact: string;
}

/**
 * Rough token count; good enough to enforce a budget without a tokenizer.
 *
 * @param text - Any text.
 * @returns An estimate of its token count.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const stamp = (instant: Date, tz: string) => formatInZone(instant, tz);

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}...` : flat;
}

/** A document title made safe to sit inside a `[label](nimbus-doc:id)` link. */
function documentLink(id: string, title: string): string {
  const label =
    title.replace(/[[\]]/g, " ").replace(/\s+/g, " ").trim() || "Untitled";
  return `[${label}](nimbus-doc:${id})`;
}

function durationText(meeting: RecalledMeeting): string {
  if (meeting.status === "LIVE") return "in progress";
  if (!meeting.endedAt) return "duration unknown";
  const minutes = Math.max(
    1,
    Math.round(
      (meeting.endedAt.getTime() - meeting.startedAt.getTime()) / 60000,
    ),
  );
  return `${minutes} min`;
}

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

function renderActionItem(item: RecalledActionItem, tz: string): string {
  const parts = [`${item.text}`, `owner ${item.owner ?? "unassigned"}`];
  if (item.dueDate) parts.push(`due ${isoDay(item.dueDate)}`);
  parts.push(
    item.status === "DONE" && item.completedAt
      ? `DONE (completed ${stamp(item.completedAt, tz)})`
      : item.status,
  );
  return parts.join(" | ");
}

function meetingHeader(meeting: RecalledMeeting, tz: string): string {
  const people = meeting.participants.length
    ? meeting.participants.slice(0, 6).join(", ") +
      (meeting.participants.length > 6
        ? ` +${meeting.participants.length - 6} more`
        : "")
    : "no transcript";
  return `[${stamp(meeting.startedAt, tz)}] Meeting "${truncate(
    meeting.title ?? "Untitled",
    80,
  )}" (${durationText(meeting)}, ${people})`;
}

/**
 * Renders one meeting. The compact form keeps the header, a short summary,
 * the decisions and the action items, and drops open questions and transcript.
 *
 * @param meeting - The meeting.
 * @param tz - The user's timezone.
 * @param compact - True for the short form.
 * @returns Indented multi-line text starting with the dated header.
 */
export function renderMeeting(
  meeting: RecalledMeeting,
  tz: string,
  compact: boolean,
): string {
  const lines = [meetingHeader(meeting, tz)];
  if (meeting.notesDocument) {
    lines.push(
      `  Notes document: ${documentLink(
        meeting.notesDocument.id,
        meeting.notesDocument.title,
      )}`,
    );
  }

  if (meeting.summary === null) {
    lines.push(`  Status: ${meeting.status}, no notes recorded`);
    const excerpt = meeting.excerpt.slice(0, compact ? 2 : EXCERPT_LINES);
    if (excerpt.length) {
      lines.push("  Transcript excerpt:");
      for (const line of excerpt) {
        lines.push(`  - ${line.speaker}: ${truncate(line.text, 160)}`);
      }
    }
  } else {
    lines.push(`  Summary: ${truncate(meeting.summary, compact ? 240 : 1200)}`);
  }

  if (meeting.decisions.length) {
    lines.push("  Decisions:");
    for (const text of meeting.decisions.slice(0, compact ? 6 : 50)) {
      lines.push(`  - ${truncate(text, compact ? 160 : 500)}`);
    }
  }
  if (!compact && meeting.openQuestions.length) {
    lines.push("  Open questions:");
    for (const text of meeting.openQuestions) {
      lines.push(`  - ${truncate(text, 500)}`);
    }
  }
  if (meeting.actionItems.length) {
    lines.push("  Action items (current status):");
    for (const item of meeting.actionItems.slice(0, compact ? 6 : 50)) {
      lines.push(
        `  - ${truncate(renderActionItem(item, tz), compact ? 200 : 600)}`,
      );
    }
  }
  return lines.join("\n");
}

function renderChatLine(
  line: RecalledChatLine,
  tz: string,
  max: number,
): string {
  return `[${stamp(line.at, tz)}] ${line.author}: ${truncate(line.content, max)}`;
}

function renderLater(item: LaterItem, tz: string): string {
  const where = `[${stamp(item.meetingStartedAt, tz)}] Meeting "${truncate(
    item.meetingTitle ?? "Untitled",
    80,
  )}"`;
  return item.kind === "decision"
    ? `${where} decided: ${truncate(item.text, 300)}`
    : `${where} action item: ${truncate(item.text, 300)}${
        item.state ? ` (${item.state})` : ""
      }`;
}

/**
 * Joins the flags and sections into the block, spending the budget in the
 * order given: each item is tried in full, then compactly, then skipped.
 */
function buildBlock(
  flags: string[],
  sections: Array<{ title: string; items: Renderable[]; separator: string }>,
  budget: number,
): string {
  const out: string[] = [];
  let used = 0;
  if (flags.length) {
    const text = flags.join("\n");
    out.push(text);
    used += estimateTokens(text);
  }
  for (const section of sections) {
    if (!section.items.length) continue;
    const rendered: string[] = [];
    used += estimateTokens(section.title);
    for (const item of section.items) {
      const text =
        used + estimateTokens(item.full) <= budget ? item.full : item.compact;
      const cost = estimateTokens(text);
      if (used + cost > budget) continue;
      rendered.push(text);
      used += cost;
    }
    if (rendered.length)
      out.push(`${section.title}\n${rendered.join(section.separator)}`);
  }
  return out.join("\n\n");
}

type MeetingRow = {
  id: string;
  startedAt: Date;
  status: RecalledMeeting["status"];
  title: string | null;
};

/** Meetings of the workspace that started inside the range, oldest first. */
async function meetingsInRange(
  workspaceId: string,
  range: DateRange,
): Promise<MeetingRow[]> {
  return prisma.meeting.findMany({
    where: {
      workspaceId,
      startedAt: { gte: new Date(range.startIso), lt: new Date(range.endIso) },
    },
    orderBy: { startedAt: "asc" },
    select: { id: true, startedAt: true, status: true, title: true },
    take: 25,
  });
}

/** Chat messages of the workspace inside the ranges, oldest first. */
async function chatInRanges(
  workspaceId: string,
  ranges: DateRange[],
  exclude: string[],
  botUserId: string | undefined,
): Promise<RecalledChatLine[]> {
  if (ranges.length === 0) return [];
  const rows = await prisma.message.findMany({
    where: {
      workspaceId,
      id: { notIn: exclude },
      OR: ranges.map((range) => ({
        createdAt: {
          gte: new Date(range.startIso),
          lt: new Date(range.endIso),
        },
      })),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 200,
    include: { user: { select: { name: true } } },
  });
  return rows.map((row) => toChatLine(botUserId, row));
}

function toChatLine(
  botUserId: string | undefined,
  row: {
    id: string;
    createdAt: Date;
    content: string;
    imageUrl: string | null;
    userId: string;
    user: { name: string | null };
  },
): RecalledChatLine {
  const isBot = row.userId === botUserId;
  const text = row.content.trim();
  return {
    id: row.id,
    at: row.createdAt,
    author: isBot ? "NimbusBot" : (row.user.name ?? "User"),
    isBot,
    content: row.imageUrl ? `${text} [attached an image]`.trim() : text,
  };
}

/** Keyword scores per meeting across transcripts, decisions, action items and titles. */
async function keywordMeetingScores(
  workspaceId: string,
  query: string,
): Promise<Map<string, number>> {
  const [segments, decisions, actions, titles] = await Promise.allSettled([
    searchSegments(workspaceId, query, { limit: 40 }),
    prisma.$queryRaw<Array<{ meetingId: string }>>`
      SELECT d."meetingId" FROM "decision" d
      WHERE d."workspaceId" = ${workspaceId}
        AND to_tsvector('simple', d."text") @@ websearch_to_tsquery('simple', ${query})
      LIMIT 40`,
    prisma.$queryRaw<Array<{ meetingId: string }>>`
      SELECT a."meetingId" FROM "action_item" a
      WHERE a."workspaceId" = ${workspaceId}
        AND a."meetingId" IS NOT NULL
        AND to_tsvector('simple', a."text") @@ websearch_to_tsquery('simple', ${query})
      LIMIT 40`,
    prisma.$queryRaw<Array<{ meetingId: string }>>`
      SELECT m."id" AS "meetingId" FROM "Meeting" m
      WHERE m."workspaceId" = ${workspaceId}
        AND to_tsvector('simple', COALESCE(m."title", '')) @@ websearch_to_tsquery('simple', ${query})
      LIMIT 40`,
  ]);

  const scores = new Map<string, number>();
  const add = (result: PromiseSettledResult<unknown>, weight: number) => {
    if (result.status !== "fulfilled") return;
    const list = Array.isArray(result.value) ? result.value : [];
    for (const row of list) {
      const id = (row as { meetingId?: string }).meetingId;
      if (id) scores.set(id, (scores.get(id) ?? 0) + weight);
    }
  };
  add(segments, 1);
  add(decisions, 2);
  add(actions, 2);
  add(titles, 3);
  return scores;
}

/** Ids of chat messages in the workspace matching the keywords, best first. */
async function keywordChatIds(
  workspaceId: string,
  query: string,
  exclude: string[],
): Promise<string[]> {
  try {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT m."id"
      FROM "Message" m
      CROSS JOIN LATERAL (SELECT websearch_to_tsquery('simple', ${query}) AS "query") q
      WHERE m."workspaceId" = ${workspaceId}
        AND to_tsvector('simple', m."content") @@ q."query"
        AND NOT (m."id" = ANY(${exclude}::text[]))
      ORDER BY ts_rank(to_tsvector('simple', m."content"), q."query") DESC, m."createdAt" DESC
      LIMIT 20`;
    return rows.map((row) => row.id);
  } catch (error) {
    console.error(
      "Chat keyword recall failed:",
      error instanceof Error ? error.name : "unknown",
    );
    return [];
  }
}

/** Loads full meeting records, keeping the order of `ids`. */
async function loadMeetings(
  workspaceId: string,
  ids: string[],
  scores: Map<string, number>,
): Promise<RecalledMeeting[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.meeting.findMany({
    where: { workspaceId, id: { in: ids } },
    include: {
      decisions: { orderBy: { createdAt: "asc" } },
      actionItems: {
        orderBy: { createdAt: "asc" },
        include: { owner: { select: { name: true } } },
      },
      notesDocument: { select: { id: true, title: true } },
    },
  });
  const speakers = await prisma.transcriptSegment.findMany({
    where: { meetingId: { in: ids } },
    distinct: ["meetingId", "speakerName"],
    orderBy: [{ meetingId: "asc" }, { seq: "asc" }],
    select: { meetingId: true, speakerName: true },
  });

  const byId = new Map(rows.map((row) => [row.id, row]));
  const meetings: RecalledMeeting[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) continue;
    const notes = MeetingSummarySchema.safeParse(row.summary);
    const excerpt = notes.success
      ? []
      : (
          await prisma.transcriptSegment.findMany({
            where: { meetingId: id },
            orderBy: { seq: "asc" },
            take: EXCERPT_LINES,
            select: { speakerName: true, text: true },
          })
        ).map((segment) => ({
          speaker: segment.speakerName,
          text: segment.text,
        }));
    meetings.push({
      id,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      status: row.status,
      title: row.title,
      participants: speakers
        .filter((speaker) => speaker.meetingId === id)
        .map((speaker) => speaker.speakerName),
      summary: notes.success ? notes.data.summary : null,
      openQuestions: notes.success ? notes.data.openQuestions : [],
      decisions: row.decisions.map((decision) => decision.text),
      actionItems: row.actionItems.map((item) => ({
        text: item.text,
        owner: item.owner?.name ?? item.ownerName ?? null,
        dueDate: item.dueDate,
        status: item.status,
        completedAt: item.completedAt,
      })),
      notesDocument: row.notesDocument,
      excerpt,
      score: scores.get(id) ?? 0,
    });
  }
  return meetings;
}

/**
 * Decisions and action items from meetings after the recalled ones that share
 * a topic with them, so a "still the plan?" question can be answered as
 * then-versus-now.
 */
async function laterItems(
  workspaceId: string,
  base: RecalledMeeting[],
  keywords: string[],
  now: Date,
): Promise<LaterItem[]> {
  const topic = new Set([
    ...keywords,
    ...base.flatMap((meeting) => [
      ...meeting.decisions.flatMap(significantWords),
      ...meeting.actionItems.flatMap((item) => significantWords(item.text)),
    ]),
  ]);
  if (topic.size === 0) return [];

  const earliest = Math.min(
    ...base.map((meeting) => meeting.startedAt.getTime()),
  );
  const rows = await prisma.meeting.findMany({
    where: {
      workspaceId,
      id: { notIn: base.map((meeting) => meeting.id) },
      startedAt: { gt: new Date(earliest), lte: now },
    },
    orderBy: { startedAt: "asc" },
    take: 20,
    include: {
      decisions: { orderBy: { createdAt: "asc" } },
      actionItems: { orderBy: { createdAt: "asc" } },
    },
  });

  const related = (text: string): boolean => {
    const words = significantWords(text);
    if (keywords.length && !keywords.some((word) => words.includes(word))) {
      return false;
    }
    const shared = words.filter((word) => topic.has(word)).length;
    return shared >= 2 || (shared >= 1 && words.length <= 3);
  };

  const items: LaterItem[] = [];
  for (const row of rows) {
    for (const decision of row.decisions) {
      if (related(decision.text)) {
        items.push({
          kind: "decision",
          meetingStartedAt: row.startedAt,
          meetingTitle: row.title,
          text: decision.text,
          state: null,
        });
      }
    }
    for (const item of row.actionItems) {
      if (related(item.text)) {
        items.push({
          kind: "action",
          meetingStartedAt: row.startedAt,
          meetingTitle: row.title,
          text: item.text,
          state: item.status,
        });
      }
    }
  }
  return items.slice(-MAX_LATER_ITEMS);
}

const EMPTY: RecallResult = {
  meetings: [],
  chat: [],
  later: [],
  flags: [],
  block: "",
};

/**
 * Looks up the workspace's recorded past for one question.
 *
 * @param workspaceId - The workspace; nothing outside it is read.
 * @param understanding - The parsed question from `understand`.
 * @param options - Excluded history, timezone, clock and budget.
 * @returns The recalled records, the flags and the rendered block. Throws on
 *          database failure; the caller degrades to no block.
 */
export async function recall(
  workspaceId: string,
  understanding: Understanding,
  options: RecallOptions,
): Promise<RecallResult> {
  const { ranges, searchQuery, refersToPast, refersToMeeting } = understanding;
  if (ranges.length === 0 && !refersToPast && !understanding.asksAboutChange) {
    return EMPTY;
  }

  const { tz, now } = options;
  const budget = options.tokenBudget ?? RECALL_TOKEN_BUDGET;
  const exclude = [...options.excludeMessageIds];
  const flags: string[] = [];

  const scores = searchQuery
    ? await keywordMeetingScores(workspaceId, searchQuery)
    : new Map<string, number>();
  const keywordChat = searchQuery
    ? await keywordChatIds(workspaceId, searchQuery, exclude)
    : [];
  const keywordChatSet = new Set(keywordChat);
  const score = (id: string) => scores.get(id) ?? 0;

  // Meetings in each named range. A single day with several meetings that the
  // question does not single out is ambiguous rather than answered.
  const selected: MeetingRow[] = [];
  const ambiguous: Array<{ range: DateRange; candidates: MeetingRow[] }> = [];
  let inRangeMeetings = 0;
  for (const range of ranges) {
    const list = await meetingsInRange(workspaceId, range);
    inRangeMeetings += list.length;
    if (range.kind === "day" && refersToMeeting && list.length >= 2) {
      const hits = list.filter((meeting) => score(meeting.id) > 0);
      if (hits.length === 1) selected.push(hits[0]!);
      else ambiguous.push({ range, candidates: list });
    } else {
      selected.push(...list);
    }
  }
  selected.sort(
    (a, b) =>
      score(b.id) - score(a.id) ||
      a.startedAt.getTime() - b.startedAt.getTime(),
  );

  const rangeChat = await chatInRanges(
    workspaceId,
    ranges,
    exclude,
    options.botUserId,
  );
  const inRange = inRangeMeetings > 0 || rangeChat.length > 0;

  let meetingIds = selected.map((meeting) => meeting.id);
  let chat: RecalledChatLine[];
  let hiddenMeetings = 0;

  if (inRange) {
    hiddenMeetings = Math.max(0, meetingIds.length - MAX_RECALLED_MEETINGS);
    meetingIds = meetingIds.slice(0, MAX_RECALLED_MEETINGS);
    const priority = (line: RecalledChatLine) =>
      line.isBot ||
      /@nimbusbot/i.test(line.content) ||
      keywordChatSet.has(line.id);
    const first = rangeChat.filter(priority);
    const rest = rangeChat.filter((line) => !priority(line));
    const room = Math.max(0, MAX_CHAT_LINES - first.length);
    chat = [
      ...first.slice(-MAX_CHAT_LINES),
      ...rest.slice(Math.max(0, rest.length - room)),
    ].sort((a, b) => a.at.getTime() - b.at.getTime());
  } else {
    if (refersToPast && ranges.length > 0) {
      flags.push(
        `${FLAG_NO_HISTORY_ON_DATE}: nothing is recorded ${ranges
          .map((range) =>
            range.kind === "week"
              ? `in the week of ${range.label}`
              : `on ${range.label}`,
          )
          .join(", ")}.`,
      );
    }
    meetingIds = [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_KEYWORD_MEETINGS)
      .map(([id]) => id);
    const rows = keywordChat.length
      ? await prisma.message.findMany({
          where: {
            workspaceId,
            id: { in: keywordChat.slice(0, MAX_KEYWORD_CHAT) },
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          include: { user: { select: { name: true } } },
        })
      : [];
    chat = rows.map((row) => toChatLine(options.botUserId, row));
  }

  if (ambiguous.length > 0) {
    for (const { range, candidates } of ambiguous) {
      flags.push(
        `${FLAG_AMBIGUOUS}: ${candidates.length} meetings on ${range.label} and the question does not say which: ${candidates
          .map(
            (meeting) =>
              `${stamp(meeting.startedAt, tz)} "${truncate(
                meeting.title ?? "Untitled",
                60,
              )}" (${meeting.status})`,
          )
          .join("; ")}. Ask which one the user means.`,
      );
    }
  }

  const meetings = await loadMeetings(workspaceId, meetingIds, scores);

  if (
    refersToPast &&
    meetings.length === 0 &&
    chat.length === 0 &&
    ambiguous.length === 0
  ) {
    flags.push(
      `${FLAG_NO_MATCHING_HISTORY}: nothing in the history matches this reference.`,
    );
  }

  const withRecords = meetings.filter(
    (meeting) => meeting.decisions.length || meeting.actionItems.length,
  );
  const later =
    understanding.asksAboutChange && withRecords.length > 0
      ? await laterItems(workspaceId, withRecords, understanding.keywords, now)
      : [];

  const meetingSection = {
    separator: "\n\n",
    title: "Meetings (dates are in the user's timezone):",
    items: meetings.map((meeting) => ({
      full: renderMeeting(meeting, tz, false),
      compact: renderMeeting(meeting, tz, true),
    })),
  };
  if (hiddenMeetings > 0) {
    meetingSection.items.push({
      full: `(${hiddenMeetings} more meeting${hiddenMeetings === 1 ? "" : "s"} in this period not shown)`,
      compact: `(${hiddenMeetings} more not shown)`,
    });
  }
  const laterSection = {
    separator: "\n",
    title:
      "Later meetings on the same topics (compare with the meetings above to say what changed):",
    items: later.map((item) => {
      const text = renderLater(item, tz);
      return { full: text, compact: text };
    }),
  };
  const chatSection = {
    separator: "\n",
    title: "Workspace chat (dates are in the user's timezone):",
    items: chat.map((line) => ({
      full: renderChatLine(line, tz, 400),
      compact: renderChatLine(line, tz, 160),
    })),
  };

  // The question decides which record gets the budget first.
  const sections = refersToMeeting
    ? [meetingSection, laterSection, chatSection]
    : [chatSection, meetingSection, laterSection];

  return {
    meetings,
    chat,
    later,
    flags,
    block: buildBlock(flags, sections, budget),
  };
}
