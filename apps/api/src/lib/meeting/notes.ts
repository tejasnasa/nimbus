/**
 * @module api/lib/meeting/notes
 * @description Writing the notes for a meeting that has ended: one model call
 * over the whole transcript, validated, then stored as decisions, action items
 * and a markdown document in a single transaction, and announced.
 *
 * The transcript is sent as `[mm:ss] #seq Name: text` lines. The model cites
 * the `#seq` of the line a decision or action item came from, which becomes the
 * item's `sourceSegmentId`, and it is told the meeting's date so a relative
 * phrase ("by Friday") can be turned into an ISO date. Owners come back as
 * spoken names and are matched to members by `resolveOwner`.
 *
 * @important Writing is idempotent. The final step is a conditional update that
 *            only succeeds while the meeting is `ENDED` or `FAILED`; once it has
 *            flipped to `SUMMARIZED`, running again changes nothing and creates
 *            no second document. A Redis lock keeps two runs (the one queued at
 *            the end and the recovery sweep) from both calling the model.
 *
 * @important {@link writeNotes} never throws. A failure marks the meeting
 *            `FAILED` with a curated `failureReason` and leaves the transcript
 *            alone; the recovery sweep retries until `summaryAttempts` reaches
 *            {@link NOTES_MAX_ATTEMPTS}. A meeting deleted while any of this is
 *            in flight simply stops: every write is conditional on the row.
 *
 * @important Notes are queued a few seconds after the meeting ends
 *            ({@link NOTES_START_DELAY_MS}) so captions the agent flushes while
 *            leaving are in the transcript the model reads. The timer is
 *            unref'd and process-local; losing it to a restart is what the
 *            recovery sweep is for.
 */
import { prisma } from "@nimbus/db";
import { MeetingSummarySchema, type MeetingSummary } from "@nimbus/types";
import { extractJsonObject } from "@nimbus/utils";
import { postBotMessage } from "../botMessage";
import { BOT_USER_EMAIL } from "../botUser";
import { announceDocumentCreated } from "../documentEvents";
import { searchTextForNew } from "../documentText";
import { AiCallError, recordAiRefusal, withAiCall } from "../ai/callLog";
import { reasoningKwargs } from "../ai/clientFactory";
import { resolveAi } from "../ai/entitlements";
import { pubClient } from "../redis";
import { broadcastActionItems } from "./actionItems";
import type { MeetingBroadcaster } from "./lifecycle";
import { responseText } from "./modelText";
import { resolveOwner } from "./resolveOwner";

/** Fewest segments a meeting needs to be worth notes. */
export const NOTES_MIN_SEGMENTS = 3;

/** Least speech, in milliseconds, a meeting needs to be worth notes. */
export const NOTES_MIN_SPEECH_MS = 60_000;

/** How many times writing the notes is attempted before giving up. */
export const NOTES_MAX_ATTEMPTS = 3;

/** How long after a meeting ends its notes are started. */
export const NOTES_START_DELAY_MS = 5_000;

/** Hard cap for the notes JSON response. */
export const NOTES_MAX_OUTPUT_TOKENS = 4096;

/** How long a run may hold the notes lock. */
const NOTES_LOCK_TTL_SECONDS = 300;

/** The transcript is trimmed in the middle beyond this many characters. */
const MAX_TRANSCRIPT_CHARS = 150_000;

/** Longest failure reason stored. */
const MAX_REASON_LENGTH = 300;

/** Seams for the pieces that talk to the outside world. Tests only. */
export type NotesDeps = {
  /** Broadcaster for `meeting:notes-ready`, `meeting:action-items` and the bot message. */
  io?: MeetingBroadcaster;
  /** Replaces the model resolver. */
  resolve?: typeof resolveAi;
  /** Replaces the delay before queued notes start. */
  delayMs?: number;
};

/** What a run of {@link writeNotes} did. */
export type NotesOutcome =
  | "written"
  | "skipped-short"
  | "failed"
  | "ignored"
  | "busy";

/** A transcript line as the prompt needs it. */
export type NotesSegment = {
  seq: number;
  speakerName: string;
  text: string;
  startMs: number;
  endMs: number;
};

/** Redis key of the lock that keeps two runs from overlapping. */
export const notesLockKey = (meetingId: string) => `meeting:${meetingId}:notes`;

/** `mm:ss` for a millisecond offset; minutes are not wrapped at the hour. */
function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = String(Math.floor(total / 60)).padStart(2, "0");
  const seconds = String(total % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

/** `YYYY-MM-DD` of a date, in UTC. */
function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Renders the transcript for the model, one `[mm:ss] #seq Name: text` line per
 * segment. A very long transcript keeps its beginning and its end.
 *
 * @param segments - The segments in sequence order.
 */
export function buildTranscript(segments: readonly NotesSegment[]): string {
  const lines = segments.map(
    (segment) =>
      `[${clock(segment.startMs)}] #${segment.seq} ${segment.speakerName}: ${segment.text}`,
  );
  const whole = lines.join("\n");
  if (whole.length <= MAX_TRANSCRIPT_CHARS) return whole;

  const half = Math.floor(MAX_TRANSCRIPT_CHARS / 2);
  let head = 0;
  let headChars = 0;
  while (head < lines.length && headChars + lines[head]!.length < half) {
    headChars += lines[head]!.length + 1;
    head += 1;
  }
  let tail = lines.length;
  let tailChars = 0;
  while (tail > head && tailChars + lines[tail - 1]!.length < half) {
    tailChars += lines[tail - 1]!.length + 1;
    tail -= 1;
  }
  return [
    ...lines.slice(0, head),
    `[... ${tail - head} lines omitted for length ...]`,
    ...lines.slice(tail),
  ].join("\n");
}

/**
 * The instructions sent with the notes request.
 *
 * @param meetingDate - When the meeting took place, so relative dates resolve.
 */
export function buildNotesInstructions(meetingDate: Date): string {
  const weekday = meetingDate.toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: "UTC",
  });
  return `You write the notes for a meeting from its transcript.

The meeting took place on ${isoDay(meetingDate)} (a ${weekday}). Resolve any relative date a speaker used ("Friday", "next week", "tomorrow") against that date and write it as an ISO date, YYYY-MM-DD. If a due date is not stated, omit "due"; never guess one.

Each transcript line looks like "[mm:ss] #12 Name: text". The "#12" is the line's sequence number. When a decision or action item comes from a particular line, cite its number as "sourceSeq".

Write only what the transcript supports. Do not invent decisions, owners or dates. Use "ownerName" for the person who will do an action item, exactly as the speakers named them, and omit it if nobody was assigned.

Return a single JSON object and nothing else, in exactly this shape:
{
  "title": "short title, at most 80 characters",
  "summary": "what was discussed and concluded, at most 1200 characters",
  "decisions": [{ "text": "...", "sourceSeq": 12 }],
  "actionItems": [{ "text": "...", "ownerName": "Priya", "due": "2026-11-13", "sourceSeq": 14 }],
  "openQuestions": ["..."],
  "topics": ["..."]
}
Each decision, action item and open question is at most 500 characters. Use empty arrays where there is nothing to list.`;
}

/**
 * Turns the notes into the markdown the notes document is seeded with.
 *
 * @param notes - The validated notes.
 * @param owners - Display name per action item, in order; null for no owner.
 * @param dates - Due date per action item, in order, as `YYYY-MM-DD` or null.
 */
export function renderNotesMarkdown(
  notes: MeetingSummary,
  owners: ReadonlyArray<string | null>,
  dates: ReadonlyArray<string | null>,
): string {
  const decisions =
    notes.decisions.length === 0
      ? "_None recorded._"
      : notes.decisions.map((decision) => `- ${decision.text}`).join("\n");
  const actions =
    notes.actionItems.length === 0
      ? "_None recorded._"
      : notes.actionItems
          .map((item, index) => {
            const owner = owners[index];
            const due = dates[index];
            const suffix = [
              owner ? `**${owner}**` : null,
              due ? `due ${due}` : null,
            ]
              .filter(Boolean)
              .join(", ");
            return `- [ ] ${item.text}${suffix ? ` (${suffix})` : ""}`;
          })
          .join("\n");
  const questions =
    notes.openQuestions.length === 0
      ? "_None._"
      : notes.openQuestions.map((question) => `- ${question}`).join("\n");

  return `# ${notes.title}

## Summary

${notes.summary}

## Decisions

${decisions}

## Action items

${actions}

## Open questions

${questions}

Full transcript in Meetings.
`;
}

/** Reads the notes out of the model's reply, with a reason when it is unusable. */
export function parseNotes(
  text: string,
): { ok: true; notes: MeetingSummary } | { ok: false; error: string } {
  const json = extractJsonObject(text);
  if (!json) return { ok: false, error: "the reply contained no JSON object" };
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, error: "the reply was not valid JSON" };
  }
  const parsed = MeetingSummarySchema.safeParse(raw);
  if (parsed.success) return { ok: true, notes: parsed.data };
  const error = parsed.error.issues
    .slice(0, 8)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
  return { ok: false, error };
}

/** Marks a meeting's notes as failed, unless they were written meanwhile. */
async function markFailed(meetingId: string, reason: string): Promise<void> {
  await prisma.meeting.updateMany({
    where: { id: meetingId, status: { in: ["ENDED", "FAILED"] } },
    data: {
      status: "FAILED",
      failureReason: reason.slice(0, MAX_REASON_LENGTH),
    },
  });
}

/** Refusals already logged, so a capped workspace logs one per meeting. */
const refusalLogged = new Set<string>();

/**
 * Writes the notes for an ended meeting. Never throws.
 *
 * @param meetingId - The meeting.
 * @param deps - Broadcaster and test seams.
 * @returns What happened; `ignored` for a meeting that is gone, still live,
 *          already done or out of attempts.
 */
export async function writeNotes(
  meetingId: string,
  deps: NotesDeps = {},
): Promise<NotesOutcome> {
  let locked = false;
  try {
    const claimed = await pubClient.set(
      notesLockKey(meetingId),
      "1",
      "EX",
      NOTES_LOCK_TTL_SECONDS,
      "NX",
    );
    if (claimed !== "OK") return "busy";
    locked = true;
    return await run(meetingId, deps);
  } catch (error) {
    console.error(
      `[meeting] notes failed for ${meetingId}:`,
      error instanceof Error ? error.name : "unknown error",
    );
    await markFailed(meetingId, "internal-error").catch(() => undefined);
    return "failed";
  } finally {
    if (locked) await pubClient.del(notesLockKey(meetingId)).catch(() => 0);
  }
}

/** One locked attempt at the notes. */
async function run(meetingId: string, deps: NotesDeps): Promise<NotesOutcome> {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: {
      id: true,
      workspaceId: true,
      startedById: true,
      startedAt: true,
      status: true,
      endReason: true,
      summaryAttempts: true,
    },
  });
  if (!meeting) return "ignored";
  if (meeting.status !== "ENDED" && meeting.status !== "FAILED")
    return "ignored";
  if (meeting.endReason === "dispatch-failed") return "ignored";
  if (meeting.summaryAttempts >= NOTES_MAX_ATTEMPTS) return "ignored";

  const attempt = await prisma.meeting.updateMany({
    where: {
      id: meetingId,
      status: { in: ["ENDED", "FAILED"] },
      summaryAttempts: { lt: NOTES_MAX_ATTEMPTS },
    },
    data: { summaryAttempts: { increment: 1 } },
  });
  if (attempt.count === 0) return "ignored";

  const segments = await prisma.transcriptSegment.findMany({
    where: { meetingId },
    orderBy: { seq: "asc" },
    select: {
      id: true,
      seq: true,
      speakerName: true,
      text: true,
      startMs: true,
      endMs: true,
    },
  });
  const speechMs = segments.reduce(
    (total, segment) => total + Math.max(0, segment.endMs - segment.startMs),
    0,
  );
  if (segments.length < NOTES_MIN_SEGMENTS || speechMs < NOTES_MIN_SPEECH_MS) {
    const done = await prisma.meeting.updateMany({
      where: { id: meetingId, status: { in: ["ENDED", "FAILED"] } },
      data: { status: "SUMMARIZED", failureReason: null },
    });
    return done.count === 0 ? "ignored" : "skipped-short";
  }

  if (!meeting.startedById) {
    await markFailed(meetingId, "no-starter");
    return "failed";
  }
  const resolution = await (deps.resolve ?? resolveAi)({
    workspaceId: meeting.workspaceId,
    userId: meeting.startedById,
    feature: "meeting",
  });
  if (!resolution.ok) {
    if (!refusalLogged.has(meetingId)) {
      refusalLogged.add(meetingId);
      await recordAiRefusal({
        workspaceId: meeting.workspaceId,
        userId: meeting.startedById,
        feature: "meeting",
        reason: resolution.reason,
        attempted: resolution.attempted,
      }).catch(() => undefined);
    }
    await markFailed(meetingId, `ai-unavailable: ${resolution.reason}`);
    return "failed";
  }

  const handle = resolution.handle;
  const instructions = buildNotesInstructions(meeting.startedAt);
  const transcript = buildTranscript(segments);
  const baseInput = `Meeting date: ${isoDay(meeting.startedAt)}\n\nTranscript:\n${transcript}`;

  const ask = (input: string) =>
    withAiCall({ ...resolution.meta, meetingId }, () =>
      handle.client.responses.create({
        model: handle.modelId,
        instructions,
        input,
        ...reasoningKwargs(handle, "low"),
        text: { format: { type: "json_object" } },
        max_output_tokens: NOTES_MAX_OUTPUT_TOKENS,
      }),
    );

  let notes: MeetingSummary;
  try {
    let result = parseNotes(responseText(await ask(baseInput)));
    if (!result.ok) {
      result = parseNotes(
        responseText(
          await ask(
            `${baseInput}\n\nYour previous reply was rejected: ${result.error}\nReturn the corrected JSON object only.`,
          ),
        ),
      );
    }
    if (!result.ok) {
      await markFailed(meetingId, `invalid-summary: ${result.error}`);
      return "failed";
    }
    notes = result.notes;
  } catch (error) {
    const reason =
      error instanceof AiCallError ? error.reason : "provider-error";
    await markFailed(meetingId, `model-call-failed: ${reason}`);
    return "failed";
  }

  const members = await prisma.workspaceMember.findMany({
    where: {
      workspaceId: meeting.workspaceId,
      user: { email: { not: BOT_USER_EMAIL } },
    },
    select: { userId: true, user: { select: { name: true } } },
  });
  const candidates = members.map((member) => ({
    userId: member.userId,
    name: member.user.name,
  }));
  const nameById = new Map(candidates.map((c) => [c.userId, c.name]));
  const segmentBySeq = new Map(segments.map((s) => [s.seq, s.id]));

  const resolved = notes.actionItems.map((item) => ({
    item,
    ownerUserId: item.ownerName
      ? resolveOwner(item.ownerName, candidates)
      : null,
    due: item.due ? new Date(`${item.due}T00:00:00Z`) : null,
  }));

  const date = isoDay(meeting.startedAt);
  const documentTitle = `Meeting notes: ${notes.title} (${date})`;
  const markdown = renderNotesMarkdown(
    notes,
    resolved.map(({ item, ownerUserId }) =>
      ownerUserId
        ? (nameById.get(ownerUserId) ?? null)
        : (item.ownerName ?? null),
    ),
    resolved.map(({ item }) => item.due ?? null),
  );

  const notesDocument = await prisma.$transaction(async (tx) => {
    const flipped = await tx.meeting.updateMany({
      where: { id: meetingId, status: { in: ["ENDED", "FAILED"] } },
      data: {
        status: "SUMMARIZED",
        summary: notes as object,
        title: notes.title,
        failureReason: null,
      },
    });
    if (flipped.count === 0) return null;

    const document = await tx.document.create({
      data: {
        title: documentTitle,
        type: "MARKDOWN",
        workspaceId: meeting.workspaceId,
        initialContent: markdown,
        searchText: searchTextForNew({ initialContent: markdown }),
      },
    });
    await tx.meeting.update({
      where: { id: meetingId },
      data: { notesDocumentId: document.id },
    });
    await tx.decision.createMany({
      data: notes.decisions.map((decision) => ({
        workspaceId: meeting.workspaceId,
        meetingId,
        text: decision.text,
        sourceSegmentId:
          decision.sourceSeq != null
            ? (segmentBySeq.get(decision.sourceSeq) ?? null)
            : null,
      })),
    });
    await tx.actionItem.createMany({
      data: resolved.map(({ item, ownerUserId, due }) => ({
        workspaceId: meeting.workspaceId,
        meetingId,
        text: item.text,
        ownerUserId,
        ownerName: item.ownerName ?? null,
        dueDate: due,
        sourceSegmentId:
          item.sourceSeq != null
            ? (segmentBySeq.get(item.sourceSeq) ?? null)
            : null,
      })),
    });
    return document;
  });
  if (notesDocument === null) return "ignored";
  const documentId = notesDocument.id;

  refusalLogged.delete(meetingId);
  announceDocumentCreated(deps.io, notesDocument);
  deps.io
    ?.to(meeting.workspaceId)
    .emit("meeting:notes-ready", { meetingId, documentId });
  await broadcastActionItems(deps.io, {
    workspaceId: meeting.workspaceId,
    meetingId,
  }).catch(() => undefined);
  if (deps.io) {
    await postBotMessage(
      deps.io,
      meeting.workspaceId,
      notesReadyMessage(notes.title, documentTitle, documentId),
    ).catch((error: unknown) => {
      console.error(
        `[meeting] could not post the notes message for ${meetingId}:`,
        error instanceof Error ? error.name : "unknown error",
      );
    });
  }
  return "written";
}

/**
 * The chat message NimbusBot posts when notes are ready. The second line is a
 * markdown link whose target is `nimbus-doc:<documentId>`, which the web client
 * resolves to the workspace document.
 *
 * @param title - The meeting's title.
 * @param documentTitle - The notes document's title.
 * @param documentId - The notes document's id.
 */
export function notesReadyMessage(
  title: string,
  documentTitle: string,
  documentId: string,
): string {
  return `Notes from the call are ready: ${title}.\n[${documentTitle}](nimbus-doc:${documentId})`;
}

const scheduled = new Set<NodeJS.Timeout>();

/**
 * Queues the notes for a meeting that has just ended, a few seconds from now.
 *
 * @param meetingId - The meeting.
 * @param deps - Broadcaster and test seams.
 */
export function scheduleNotes(meetingId: string, deps: NotesDeps = {}): void {
  const timer = setTimeout(() => {
    scheduled.delete(timer);
    void writeNotes(meetingId, deps);
  }, deps.delayMs ?? NOTES_START_DELAY_MS);
  timer.unref();
  scheduled.add(timer);
}

/**
 * Cancels every queued notes run. Tests only.
 *
 * @returns How many were queued.
 */
export function clearScheduledNotes(): number {
  const queued = scheduled.size;
  for (const timer of scheduled) clearTimeout(timer);
  scheduled.clear();
  return queued;
}
