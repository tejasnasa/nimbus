/**
 * @module api/lib/meeting/translation
 * @description Translating new captions into the languages the people watching
 * a meeting have chosen, storing the result and announcing it.
 *
 * Segments that arrive close together are translated in one model call. The
 * request carries the three segments before the batch as context, which the
 * model reads but does not translate, so pronouns and terms carry over.
 *
 * @important Translation never blocks or fails ingestion. {@link translateSegments}
 *            is called detached, swallows every failure (logging only a curated
 *            reason) and leaves the caption in its original language, which is
 *            also what viewers see while a translation is still in flight.
 *
 * @important Languages are requested only for what connected viewers currently
 *            want (see `captionLanguages`), minus each segment's own language. A
 *            meeting nobody reads translated costs nothing, not even a lookup of
 *            the meeting.
 *
 * @important Translation stops with the meeting and with the spend cap. Each
 *            batch re-reads the meeting and goes through `resolveAi`, so a
 *            meeting that has ended, or a workspace whose own key has reached its
 *            monthly cap, gets no further calls. Free-tier translation is
 *            covered by the free voice allowance and is not capped here.
 */
import { prisma } from "@nimbus/db";
import type { SegmentDTO } from "@nimbus/types";
import { extractJsonObject, normalizeCaptionLanguage } from "@nimbus/utils";
import { recordAiRefusal, withAiCall } from "../ai/callLog";
import { reasoningKwargs } from "../ai/clientFactory";
import { resolveAi } from "../ai/entitlements";
import { activeCaptionLanguages } from "./captionLanguages";
import type { MeetingBroadcaster } from "./lifecycle";

/** How long segments arriving after the first are held to join its batch. */
export const TRANSLATION_BATCH_MS = 400;

/** How many segments before a batch are sent as untranslated context. */
export const TRANSLATION_CONTEXT_SEGMENTS = 3;

/** Hard cap for the translation JSON response. */
export const TRANSLATION_MAX_OUTPUT_TOKENS = 4096;

/** The language assumed for a segment the transcriber did not tag. */
const DEFAULT_SOURCE_LANGUAGE = "en";

/** Seams for the pieces that talk to the outside world. Tests only. */
export type TranslationDeps = {
  /** Broadcaster for `meeting:translation`. */
  io?: MeetingBroadcaster;
  /** Replaces the model resolver. */
  resolve?: typeof resolveAi;
  /** Replaces the batching window. */
  batchMs?: number;
};

/** The meeting fields translation needs. */
export type TranslationMeeting = { id: string; workspaceId: string };

type Batch = {
  segments: SegmentDTO[];
  done: Promise<void>;
};

const pending = new Map<string, Batch>();

/** Meetings whose refusal has been logged, so a capped workspace logs once. */
const refusalLogged = new Set<string>();

/** Pulls the response text from a completed Responses API result. */
function responseText(response: unknown): string {
  const direct = (response as { output_text?: unknown }).output_text;
  if (typeof direct === "string" && direct.length > 0) return direct;
  const output = (response as { output?: unknown }).output;
  if (!Array.isArray(output)) return "";
  for (const item of output as Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>) {
    if (item.type !== "message" || !item.content) continue;
    for (const part of item.content) {
      if (part.type === "output_text" && part.text) return part.text;
    }
  }
  return "";
}

/**
 * The instructions sent with every translation request.
 *
 * @param languages - The target languages in play, as codes.
 */
export function buildTranslationInstructions(languages: readonly string[]) {
  return `You translate live meeting captions.

Translate each segment faithfully into each of the target languages listed for it. Keep names of people, products and places, and technical terms, as spoken. Do not summarise, explain or add commentary.

The "context" segments came before the batch. Read them to resolve pronouns and terms, but never translate them.

Return a single JSON object and nothing else, in exactly this shape:
{ "translations": { "<seq>": { "<language code>": "translated text" } } }

Use the segment's "seq" as the key, and only the language codes listed in its "targets" (possible codes: ${languages.join(", ")}). Omit a segment or language you cannot translate.`;
}

/** The targets of one segment: the active languages minus its own. */
function targetsFor(segment: SegmentDTO, active: readonly string[]): string[] {
  const own =
    normalizeCaptionLanguage(segment.language) ?? DEFAULT_SOURCE_LANGUAGE;
  return active.filter((language) => language !== own);
}

/**
 * Reads the model's reply into `seq -> language -> text`, ignoring anything
 * malformed so a partly usable reply still yields its usable part.
 *
 * @param text - The raw model output.
 */
export function parseTranslations(
  text: string,
): Map<number, Map<string, string>> {
  const result = new Map<number, Map<string, string>>();
  const json = extractJsonObject(text);
  if (!json) return result;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return result;
  }
  const table = (parsed as { translations?: unknown } | null)?.translations;
  if (!table || typeof table !== "object") return result;
  for (const [seqKey, byLanguage] of Object.entries(table)) {
    const seq = Number(seqKey);
    if (!Number.isInteger(seq) || !byLanguage || typeof byLanguage !== "object")
      continue;
    for (const [language, value] of Object.entries(byLanguage)) {
      if (typeof value !== "string" || value.trim().length === 0) continue;
      const row = result.get(seq) ?? new Map<string, string>();
      row.set(language, value.trim());
      result.set(seq, row);
    }
  }
  return result;
}

/** Translates one flushed batch. Never throws. */
async function runBatch(
  meeting: TranslationMeeting,
  segments: SegmentDTO[],
  deps: TranslationDeps,
): Promise<void> {
  try {
    const active = await activeCaptionLanguages(meeting.id);
    if (active.length === 0) return;

    const row = await prisma.meeting.findUnique({
      where: { id: meeting.id },
      select: { status: true, startedById: true, workspaceId: true },
    });
    if (!row || row.status !== "LIVE") {
      refusalLogged.delete(meeting.id);
      return;
    }
    if (!row.startedById) return;

    const work = segments
      .map((segment) => ({ segment, targets: targetsFor(segment, active) }))
      .filter((entry) => entry.targets.length > 0);
    if (work.length === 0) return;

    const resolution = await (deps.resolve ?? resolveAi)({
      workspaceId: row.workspaceId,
      userId: row.startedById,
      feature: "meeting",
    });
    if (!resolution.ok) {
      if (!refusalLogged.has(meeting.id)) {
        refusalLogged.add(meeting.id);
        console.error(
          `[meeting] translation paused for ${meeting.id}: ${resolution.reason}`,
        );
        await recordAiRefusal({
          workspaceId: row.workspaceId,
          userId: row.startedById,
          feature: "meeting",
          reason: resolution.reason,
          attempted: resolution.attempted,
        }).catch(() => undefined);
      }
      return;
    }

    const firstSeq = Math.min(...work.map((entry) => entry.segment.seq));
    const context = await prisma.transcriptSegment.findMany({
      where: { meetingId: meeting.id, seq: { lt: firstSeq } },
      orderBy: { seq: "desc" },
      take: TRANSLATION_CONTEXT_SEGMENTS,
      select: { seq: true, speakerName: true, text: true },
    });
    context.reverse();

    const input = JSON.stringify({
      context: context.map((c) => ({
        seq: c.seq,
        speaker: c.speakerName,
        text: c.text,
      })),
      segments: work.map(({ segment, targets }) => ({
        seq: segment.seq,
        speaker: segment.speakerName,
        text: segment.text,
        targets,
      })),
    });

    const handle = resolution.handle;
    const response = await withAiCall(
      { ...resolution.meta, meetingId: meeting.id },
      () =>
        handle.client.responses.create({
          model: handle.modelId,
          instructions: buildTranslationInstructions(active),
          input,
          ...reasoningKwargs(handle, "low"),
          text: { format: { type: "json_object" } },
          max_output_tokens: TRANSLATION_MAX_OUTPUT_TOKENS,
        }),
    );

    const parsed = parseTranslations(responseText(response));
    const stored: Array<{
      segmentId: string;
      seq: number;
      language: string;
      text: string;
    }> = [];
    for (const { segment, targets } of work) {
      const byLanguage = parsed.get(segment.seq);
      if (!byLanguage) continue;
      for (const language of targets) {
        const text = byLanguage.get(language);
        if (text) {
          stored.push({
            segmentId: segment.id,
            seq: segment.seq,
            language,
            text,
          });
        }
      }
    }
    if (stored.length === 0) return;

    await prisma.$transaction(
      stored.map(({ segmentId, language, text }) =>
        prisma.segmentTranslation.upsert({
          where: { segmentId_language: { segmentId, language } },
          create: { segmentId, language, text },
          update: { text },
        }),
      ),
    );

    for (const { seq, language, text } of stored) {
      deps.io?.to(meeting.workspaceId).emit("meeting:translation", {
        meetingId: meeting.id,
        seq,
        language,
        text,
      });
    }
  } catch (error) {
    console.error(
      `[meeting] translation failed for ${meeting.id}:`,
      error instanceof Error ? error.name : "unknown error",
    );
  }
}

/**
 * Queues new captions for translation into the languages being read.
 *
 * Segments queued within {@link TRANSLATION_BATCH_MS} of the first one share a
 * model call. The returned promise settles when the batch they joined has been
 * handled; callers on the ingest path do not await it.
 *
 * @param meeting - The meeting the segments belong to.
 * @param segments - Newly stored captions, in sequence order.
 * @param deps - Broadcaster and test seams.
 */
export function translateSegments(
  meeting: TranslationMeeting,
  segments: readonly SegmentDTO[],
  deps: TranslationDeps = {},
): Promise<void> {
  if (segments.length === 0) return Promise.resolve();

  const existing = pending.get(meeting.id);
  if (existing) {
    existing.segments.push(...segments);
    return existing.done;
  }

  let release!: () => void;
  const done = new Promise<void>((resolve) => {
    release = resolve;
  });
  const batch: Batch = { segments: [...segments], done };
  pending.set(meeting.id, batch);

  const timer = setTimeout(() => {
    pending.delete(meeting.id);
    const ordered = batch.segments.sort((a, b) => a.seq - b.seq);
    void runBatch(meeting, ordered, deps).finally(release);
  }, deps.batchMs ?? TRANSLATION_BATCH_MS);
  timer.unref();
  return done;
}
