/**
 * @module testhelpers/meetings
 * @description Fixtures for the meeting notes suites: a resolver that hands out
 * a stub model client, a transcript seeder and a well-formed model reply.
 *
 * No model is ever called. The stub's `responses.create` is whatever mock the
 * test passes in, so a test controls exactly what the "model" says.
 */
import type { MeetingSummary } from "@nimbus/types";
import type { AiClientHandle } from "../src/lib/ai/clientFactory";
import type { resolveAi } from "../src/lib/ai/entitlements";
import { testPrisma } from "./database";

/**
 * Builds a `resolveAi` replacement that always succeeds with a stub client.
 *
 * @param create - Stands in for `client.responses.create`.
 * @param source - Whose key the resolution claims to be using.
 */
export const stubResolver = (
  create: (...args: unknown[]) => unknown,
  source: "byok" | "free" = "byok",
): typeof resolveAi => {
  const handle = {
    providerId: "openai",
    modelId: "test-model",
    source,
    supportsReasoning: false,
    client: { responses: { create } },
  } as unknown as AiClientHandle;
  return (async (input: Parameters<typeof resolveAi>[0]) => ({
    ok: true as const,
    source,
    providerId: "openai" as const,
    modelId: "test-model",
    handle,
    substituted: false,
    meta: {
      workspaceId: input.workspaceId,
      userId: input.userId,
      feature: input.feature,
      providerId: "openai",
      modelId: "test-model",
      source,
    },
  })) as unknown as typeof resolveAi;
};

/** A `resolveAi` replacement that always refuses. */
export const refusingResolver = (): typeof resolveAi =>
  (async () => ({
    ok: false as const,
    reason: "no-key",
    message: "No key",
    cta: "add-key" as const,
  })) as unknown as typeof resolveAi;

/**
 * Stores a transcript for a meeting: one segment per line, twenty seconds
 * each, so four lines clear the minimum amount of speech.
 *
 * @param meetingId - The meeting.
 * @param lines - Speaker and text per segment, in order. Sequence numbers start at 1.
 * @returns The stored segments' ids, in order.
 */
export async function seedTranscript(
  meetingId: string,
  lines: ReadonlyArray<{
    speakerName: string;
    text: string;
    speakerUserId?: string | null;
  }>,
  options: { segmentMs?: number } = {},
): Promise<string[]> {
  const segmentMs = options.segmentMs ?? 20_000;
  const created = await testPrisma.transcriptSegment.createManyAndReturn({
    data: lines.map((line, index) => ({
      meetingId,
      seq: index + 1,
      speakerName: line.speakerName,
      speakerUserId: line.speakerUserId ?? null,
      text: line.text,
      startMs: index * segmentMs,
      endMs: index * segmentMs + segmentMs,
    })),
  });
  return created.sort((a, b) => a.seq - b.seq).map((row) => row.id);
}

/** A transcript long enough to be worth notes. */
export const SAMPLE_LINES = [
  { speakerName: "Priya Shah", text: "Let us ship the beta on Friday." },
  { speakerName: "Tom Brandt", text: "Agreed, I will update the changelog." },
  { speakerName: "Priya Shah", text: "Who owns the migration rollback plan?" },
  { speakerName: "Tom Brandt", text: "Priya will write the rollback plan." },
] as const;

/**
 * A valid set of notes, for a model stub to return.
 *
 * @param overrides - Fields to replace.
 */
export const sampleNotes = (
  overrides: Partial<MeetingSummary> = {},
): MeetingSummary => ({
  title: "Beta launch planning",
  summary: "The team agreed to ship the beta on Friday.",
  decisions: [{ text: "Ship the beta on Friday", sourceSeq: 1 }],
  actionItems: [
    {
      text: "Update the changelog",
      ownerName: "Tom",
      due: "2026-11-13",
      sourceSeq: 2,
    },
    { text: "Write the rollback plan", ownerName: "Priya", sourceSeq: 4 },
  ],
  openQuestions: ["Who reviews the rollback plan?"],
  topics: ["beta launch", "rollback"],
  ...overrides,
});

/** A model reply carrying `value` as the response text. */
export const modelReply = (value: unknown) => ({
  output_text: typeof value === "string" ? value : JSON.stringify(value),
  output: [],
});

/** One broadcast captured by {@link fakeIo}. */
export type Emitted = { room: string; event: string; payload: unknown };

/**
 * A broadcaster that records what is sent instead of sending it, for suites
 * that assert on broadcasts without a socket server. Nothing is published
 * through Redis, so nothing can outlive the test.
 */
export const fakeIo = () => {
  const emitted: Emitted[] = [];
  const io = {
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => {
        emitted.push({ room, event, payload });
        return true;
      },
    }),
  } as never;
  return { io, emitted };
};
