/**
 * @module api/scripts/seed_e2e_meeting
 * @description Seeds one live meeting with a four-line transcript in the
 * end-to-end workspace, for `apps/web/e2e/meeting-notes.spec.ts`. A call
 * normally needs a media room, an agent and real audio to produce a transcript;
 * this stores the result directly so the spec can start from "a meeting that is
 * about to end".
 *
 * Invoked by the spec as
 * `npx tsx scripts/seed_e2e_meeting.ts <workspaceId> <ownerId> <memberId>`.
 * It prints one JSON line, `{"meetingId": "..."}`, as its last output.
 *
 * @important Unlike `seed_e2e.ts` this never truncates anything. It only ends a
 *            meeting left live in that workspace by an earlier spec (at most one
 *            may be live) and adds its own rows, so the shared seed survives.
 *            `.env.test` is loaded explicitly for the same reason as there: it
 *            replaces the default `.env`, so this cannot reach a real database.
 *
 * @important The meeting is `BYOK` with no budget, so ending it charges no free
 *            voice seconds to the owner and other specs' quotas are untouched.
 *            The transcript is 80 seconds of speech over four lines, which is
 *            what clears the minimum the notes require.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
dotenv.config({ path: resolve(repoRoot, ".env.test") });

const LINES = [
  { who: "owner", text: "Let us ship the launch on Friday." },
  { who: "member", text: "Agreed, I will update the changelog." },
  { who: "owner", text: "Who owns the rollback plan?" },
  { who: "member", text: "I will write the rollback plan." },
] as const;

const SEGMENT_MS = 20_000;

async function main() {
  const [workspaceId, ownerId, memberId] = process.argv.slice(2);
  if (!workspaceId || !ownerId || !memberId) {
    throw new Error(
      "usage: seed_e2e_meeting <workspaceId> <ownerId> <memberId>",
    );
  }

  // dotenv never overrides a variable the shell already exported, so refuse
  // anything that is not a local database rather than trust the file alone.
  const host = new URL(process.env.DATABASE_URL ?? "postgresql://none")
    .hostname;
  if (host !== "localhost" && host !== "127.0.0.1") {
    throw new Error(`refusing to seed a non-local database (${host})`);
  }

  const { createPrismaClient } = await import("@nimbus/db");
  const db = createPrismaClient(process.env.DATABASE_URL);

  try {
    await db.meeting.updateMany({
      where: { workspaceId, status: "LIVE" },
      data: { status: "ENDED", endedAt: new Date(), endReason: "orphaned" },
    });

    const names = { owner: "E2E Owner", member: "E2E Member" };
    const ids = { owner: ownerId, member: memberId };
    const meeting = await db.meeting.create({
      data: {
        workspaceId,
        roomName: `nimbus-ws-${workspaceId}`,
        status: "LIVE",
        startedById: ownerId,
        source: "BYOK",
        startedAt: new Date(Date.now() - 10 * 60_000),
        lastSeq: LINES.length,
        segments: {
          create: LINES.map((line, index) => ({
            seq: index + 1,
            speakerUserId: ids[line.who],
            speakerName: names[line.who],
            text: line.text,
            startMs: index * SEGMENT_MS,
            endMs: (index + 1) * SEGMENT_MS,
          })),
        },
      },
      select: { id: true },
    });

    console.log(JSON.stringify({ meetingId: meeting.id }));
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
