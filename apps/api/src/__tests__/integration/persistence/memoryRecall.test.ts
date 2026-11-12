/**
 * @module api/__tests__/integration/persistence/memoryRecall
 * @description NimbusBot's recall against a real database: meetings found by
 * the date a user names (in their timezone), with their decisions and the
 * CURRENT state of their action items; the workspace chat of that day; the
 * flags for "nothing recorded", "which meeting?"; keyword matches; the
 * then-versus-now additions; the token budget; and workspace isolation.
 *
 * The clock is a fixed instant, and every record is dated relative to it, so
 * the test never depends on the day it runs.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addMember,
  closeTestResources,
  createUser,
  createWorkspace,
  resetDatabase,
  sampleNotes,
  seedTranscript,
  testPrisma,
} from "@testhelpers";
import {
  estimateTokens,
  recall,
  type RecallOptions,
} from "../../../lib/memory/recall";
import { understand } from "../../../lib/memory/understand";

const TZ = "Asia/Kolkata";
/** Wednesday 2026-11-11, 14:05 in Kolkata. */
const NOW = new Date("2026-11-11T08:35:00Z");

let workspaceId: string;
let otherWorkspaceId: string;
let botUserId: string;
let ids: {
  beta: string;
  notesDoc: string;
  standup: string;
  retro: string;
  review: string;
  failed: string;
  userMessage: string;
};

type SeedMeeting = {
  workspaceId: string;
  startedAt: string;
  minutes?: number;
  title: string | null;
  status: "LIVE" | "ENDED" | "SUMMARIZED" | "FAILED";
  summary?: ReturnType<typeof sampleNotes>;
  decisions?: string[];
  lines?: Array<{ speakerName: string; text: string }>;
};

async function seedMeeting(input: SeedMeeting) {
  const startedAt = new Date(input.startedAt);
  const meeting = await testPrisma.meeting.create({
    data: {
      workspaceId: input.workspaceId,
      roomName: `nimbus-ws-${input.workspaceId}`,
      source: "BYOK",
      status: input.status,
      title: input.title,
      startedAt,
      endedAt:
        input.status === "LIVE"
          ? null
          : new Date(startedAt.getTime() + (input.minutes ?? 30) * 60000),
      summary: input.summary ?? undefined,
    },
  });
  if (input.decisions?.length) {
    await testPrisma.decision.createMany({
      data: input.decisions.map((text) => ({
        workspaceId: input.workspaceId,
        meetingId: meeting.id,
        text,
      })),
    });
  }
  if (input.lines?.length) await seedTranscript(meeting.id, input.lines);
  return meeting;
}

const message = (
  workspace: string,
  userId: string,
  at: string,
  content: string,
) =>
  testPrisma.message.create({
    data: {
      workspaceId: workspace,
      userId,
      content,
      createdAt: new Date(at),
    },
  });

const run = (text: string, over: Partial<RecallOptions> = {}) =>
  recall(workspaceId, understand(text, NOW, TZ), {
    excludeMessageIds: new Set(),
    tz: TZ,
    botUserId,
    now: NOW,
    ...over,
  });

beforeAll(async () => {
  await resetDatabase();
  const ada = await createUser("Ada Lovelace");
  const grace = await createUser("Grace Hopper");
  workspaceId = (await createWorkspace(ada.id)).id;
  await addMember(workspaceId, grace.id);
  otherWorkspaceId = (await createWorkspace(ada.id, "Other")).id;
  // The only other user row is NimbusBot, seeded by the database reset.
  botUserId = (
    await testPrisma.user.findFirstOrThrow({
      where: { id: { notIn: [ada.id, grace.id] } },
    })
  ).id;

  // Tuesday 2026-11-10 14:00 Kolkata: the beta launch meeting, with notes.
  const notesDoc = await testPrisma.document.create({
    data: {
      title: "Meeting notes: Beta launch planning (2026-11-10)",
      type: "MARKDOWN",
      workspaceId,
    },
  });
  const beta = await seedMeeting({
    workspaceId,
    startedAt: "2026-11-10T08:30:00Z",
    minutes: 32,
    title: "Beta launch planning",
    status: "SUMMARIZED",
    summary: sampleNotes(),
    decisions: ["Ship the beta on Friday"],
    lines: [
      { speakerName: "Priya Shah", text: "Let us ship the beta on Friday." },
      {
        speakerName: "Tom Brandt",
        text: "Agreed, I will update the changelog.",
      },
    ],
  });
  await testPrisma.meeting.update({
    where: { id: beta.id },
    data: { notesDocumentId: notesDoc.id },
  });
  await testPrisma.actionItem.createMany({
    data: [
      {
        workspaceId,
        meetingId: beta.id,
        text: "Update the changelog",
        ownerName: "Tom",
        dueDate: new Date("2026-11-13T00:00:00Z"),
        status: "DONE",
        completedAt: new Date("2026-11-11T03:42:00Z"),
      },
      {
        workspaceId,
        meetingId: beta.id,
        text: "Write the rollback plan",
        ownerUserId: grace.id,
        status: "OPEN",
      },
    ],
  });

  // Wednesday 2026-11-11 09:00 Kolkata: a later meeting that changes the plan.
  const review = await seedMeeting({
    workspaceId,
    startedAt: "2026-11-11T03:30:00Z",
    title: "Launch review",
    status: "SUMMARIZED",
    summary: sampleNotes({ title: "Launch review", summary: "Beta moved." }),
    decisions: ["Ship the beta on Monday, not Friday", "Hire a designer"],
  });

  // Monday 2026-11-09: two meetings, no notes yet.
  const standup = await seedMeeting({
    workspaceId,
    startedAt: "2026-11-09T04:00:00Z",
    title: "Standup",
    status: "ENDED",
    lines: [
      {
        speakerName: "Priya Shah",
        text: "The invoices export is still broken.",
      },
    ],
  });
  const retro = await seedMeeting({
    workspaceId,
    startedAt: "2026-11-09T10:00:00Z",
    title: "Retro",
    status: "ENDED",
    lines: [
      { speakerName: "Tom Brandt", text: "The deploy pipeline needs caching." },
    ],
  });

  // Friday 2026-11-06: a meeting whose notes failed.
  const failed = await seedMeeting({
    workspaceId,
    startedAt: "2026-11-06T06:00:00Z",
    title: null,
    status: "FAILED",
    lines: [
      { speakerName: "Priya Shah", text: "Quick sync about the roadmap." },
    ],
  });

  // Another workspace, same days, with its own secrets.
  await seedMeeting({
    workspaceId: otherWorkspaceId,
    startedAt: "2026-11-10T08:30:00Z",
    title: "Secret board meeting",
    status: "SUMMARIZED",
    summary: sampleNotes({
      title: "Secret board meeting",
      summary: "Acquisition.",
    }),
    decisions: ["Acquire the competitor"],
    lines: [
      { speakerName: "Zed", text: "The acquisition invoices are ready." },
    ],
  });
  await message(
    otherWorkspaceId,
    ada.id,
    "2026-11-09T05:00:00Z",
    "secret chat about invoices",
  );

  // Monday chat: a question to the bot, its answer, and small talk.
  const userMessage = await message(
    workspaceId,
    ada.id,
    "2026-11-09T05:00:00Z",
    "@nimbusbot what is the cheapest CRM?",
  );
  await message(
    workspaceId,
    botUserId,
    "2026-11-09T05:00:30Z",
    "HubSpot has a free tier.",
  );
  await message(workspaceId, grace.id, "2026-11-09T05:10:00Z", "lunch anyone?");

  ids = {
    beta: beta.id,
    notesDoc: notesDoc.id,
    standup: standup.id,
    retro: retro.id,
    review: review.id,
    failed: failed.id,
    userMessage: userMessage.id,
  };
});

afterAll(closeTestResources);

describe("recall: meetings by date", () => {
  it("returns the meeting on the named day with its record and current status", async () => {
    const result = await run("What did we decide on Tuesday's call?");
    expect(result.meetings.map((m) => m.id)).toEqual([ids.beta]);
    expect(result.flags).toEqual([]);
    expect(result.block).toContain(
      '[Tue 2026-11-10 14:00] Meeting "Beta launch planning" (32 min, Priya Shah, Tom Brandt)',
    );
    expect(result.block).toContain(
      `[Meeting notes: Beta launch planning (2026-11-10)](nimbus-doc:${ids.notesDoc})`,
    );
    expect(result.block).toContain(
      "Summary: The team agreed to ship the beta on Friday.",
    );
    expect(result.block).toContain("- Ship the beta on Friday");
    expect(result.block).toContain("Open questions:");
    expect(result.block).toContain("Who reviews the rollback plan?");
    // Action items show their state now, not as first written down.
    expect(result.block).toContain(
      "Update the changelog | owner Tom | due 2026-11-13 | DONE (completed Wed 2026-11-11 09:12)",
    );
    expect(result.block).toContain(
      "Write the rollback plan | owner Grace Hopper | OPEN",
    );
  });

  it("uses the asker's timezone for the day boundary", async () => {
    // 04:00 UTC Monday is Monday in Kolkata, but a meeting at 20:00 UTC on
    // Sunday is Monday 01:30 there and Sunday in UTC.
    const lateSunday = await seedMeeting({
      workspaceId: otherWorkspaceId,
      startedAt: "2026-11-08T20:00:00Z",
      title: "Late sunday",
      status: "ENDED",
    });
    const inKolkata = await recall(
      otherWorkspaceId,
      understand("what did we decide on Monday", NOW, "Asia/Kolkata"),
      { excludeMessageIds: new Set(), tz: "Asia/Kolkata", now: NOW },
    );
    expect(inKolkata.meetings.map((m) => m.id)).toContain(lateSunday.id);
    const inUtc = await recall(
      otherWorkspaceId,
      understand("what did we decide on Monday", NOW, "UTC"),
      { excludeMessageIds: new Set(), tz: "UTC", now: NOW },
    );
    expect(inUtc.meetings.map((m) => m.id)).not.toContain(lateSunday.id);
  });

  it("renders a meeting without notes with its status and a transcript excerpt", async () => {
    const result = await run("What happened on Friday?");
    expect(result.meetings.map((m) => m.id)).toEqual([ids.failed]);
    expect(result.block).toContain(
      '[Fri 2026-11-06 11:30] Meeting "Untitled" (30 min, Priya Shah)',
    );
    expect(result.block).toContain("Status: FAILED, no notes recorded");
    expect(result.block).toContain("Priya Shah: Quick sync about the roadmap.");
  });

  it("flags two meetings on one day that the question does not tell apart", async () => {
    const result = await run("What did we decide in the meeting on Monday?");
    expect(result.meetings).toEqual([]);
    expect(result.flags).toHaveLength(1);
    expect(result.flags[0]).toContain("AMBIGUOUS_MATCH");
    expect(result.flags[0]).toContain('Mon 2026-11-09 09:30 "Standup"');
    expect(result.flags[0]).toContain('Mon 2026-11-09 15:30 "Retro"');
    expect(result.block.startsWith("AMBIGUOUS_MATCH")).toBe(true);
  });

  it("is not ambiguous when a keyword singles out one of the meetings", async () => {
    const result = await run(
      "What did we say about the invoices in Monday's meeting?",
    );
    expect(result.flags).toEqual([]);
    expect(result.meetings.map((m) => m.id)).toEqual([ids.standup]);
  });

  it("is not ambiguous for a chat question on a day with several meetings", async () => {
    const result = await run("What did I ask you on Monday?");
    expect(result.flags).toEqual([]);
    expect(result.meetings.map((m) => m.id).sort()).toEqual(
      [ids.standup, ids.retro].sort(),
    );
  });

  it("flags a named day on which nothing is recorded", async () => {
    const result = await run("What did we decide in the meeting on Thursday?");
    expect(result.meetings).toEqual([]);
    expect(result.flags[0]).toBe(
      "NO_HISTORY_ON_REQUESTED_DATE: nothing is recorded on 2026-11-05.",
    );
    expect(result.flags.join("\n")).toContain("NO_MATCHING_HISTORY");
    expect(result.block.startsWith("NO_HISTORY_ON_REQUESTED_DATE")).toBe(true);
  });

  it("returns every meeting of last week, capped, saying how many are left out", async () => {
    const crowded = (await createWorkspace((await createUser("Crowd")).id)).id;
    for (let hour = 0; hour < 6; hour += 1) {
      await seedMeeting({
        workspaceId: crowded,
        startedAt: `2026-11-03T0${hour}:00:00Z`,
        title: `Meeting ${hour}`,
        status: "ENDED",
      });
    }
    const result = await recall(
      crowded,
      understand("what happened last week", NOW, TZ),
      { excludeMessageIds: new Set(), tz: TZ, now: NOW },
    );
    expect(result.flags).toEqual([]);
    expect(result.meetings).toHaveLength(4);
    expect(result.block).toContain(
      "(2 more meetings in this period not shown)",
    );
  });
});

describe("recall: chat", () => {
  it("returns the day's chat with the bot's exchange first in priority", async () => {
    const result = await run("What did I ask you on Monday?");
    expect(result.chat.map((line) => line.author)).toEqual([
      "Ada Lovelace",
      "NimbusBot",
      "Grace Hopper",
    ]);
    expect(result.block).toContain(
      "[Mon 2026-11-09 10:30] Ada Lovelace: @nimbusbot what is the cheapest CRM?",
    );
    expect(result.block).toContain(
      "[Mon 2026-11-09 10:30] NimbusBot: HubSpot has a free tier.",
    );
  });

  it("leaves out the messages already sent as conversation history", async () => {
    const result = await run("What did I ask you on Monday?", {
      excludeMessageIds: new Set([ids.userMessage]),
    });
    expect(result.block).not.toContain("what is the cheapest CRM");
    expect(result.block).toContain("HubSpot has a free tier.");
  });

  it("finds a past chat message by keyword when no date is named", async () => {
    const result = await run("What did you say about HubSpot?");
    expect(result.flags).toEqual([]);
    expect(result.chat.map((line) => line.content)).toEqual([
      "HubSpot has a free tier.",
    ]);
  });
});

describe("recall: keywords", () => {
  it("finds a meeting by what was said in it", async () => {
    const result = await run("Last time we talked about invoices");
    expect(result.meetings.map((m) => m.id)).toEqual([ids.standup]);
    expect(result.flags).toEqual([]);
  });

  it("finds a meeting by a decision, ahead of unrelated ones", async () => {
    const result = await run("Did we decide anything about the beta?");
    expect(result.meetings.map((m) => m.id)[0]).toBe(ids.beta);
  });

  it("says there is no matching history when the user points at the past and nothing matches", async () => {
    const result = await run("last time we talked about zebras");
    expect(result.meetings).toEqual([]);
    expect(result.chat).toEqual([]);
    expect(result.block).toMatch(/^NO_MATCHING_HISTORY: /);
  });

  it("recalls nothing for a question about the world", async () => {
    const result = await run("What is the capital of Australia?");
    expect(result.block).toBe("");
    expect(result.flags).toEqual([]);
  });

  it("does not let a keyword search bring in another workspace's records", async () => {
    const result = await run("Last time we talked about invoices");
    expect(result.block).not.toContain("acquisition");
    expect(result.block).not.toContain("Secret board meeting");
    expect(result.block).not.toContain("secret chat");
  });
});

describe("recall: then versus now", () => {
  it("adds later decisions on the same topic when asked whether it still holds", async () => {
    const result = await run(
      "What did we decide on Tuesday, is it still the plan?",
    );
    expect(result.meetings.map((m) => m.id)).toEqual([ids.beta]);
    expect(result.later.map((item) => item.text)).toEqual([
      "Ship the beta on Monday, not Friday",
    ]);
    expect(result.block).toContain(
      "Later meetings on the same topics (compare with the meetings above to say what changed):",
    );
    expect(result.block).toContain(
      '[Wed 2026-11-11 09:00] Meeting "Launch review" decided: Ship the beta on Monday, not Friday',
    );
    expect(result.block).not.toContain("Hire a designer");
  });

  it("does not add later items to an ordinary recall", async () => {
    const result = await run("What did we decide on Tuesday's call?");
    expect(result.later).toEqual([]);
    expect(result.block).not.toContain("Later meetings");
  });
});

describe("recall: budget and isolation", () => {
  it("renders compactly when the budget is short, and in full otherwise", async () => {
    const full = await run("What did we decide on Tuesday's call?");
    const tight = await run("What did we decide on Tuesday's call?", {
      tokenBudget: estimateTokens(full.block) - 3,
    });
    expect(full.block).toContain("Open questions:");
    expect(tight.block).toContain('Meeting "Beta launch planning"');
    expect(tight.block).toContain("- Ship the beta on Friday");
    expect(tight.block).not.toContain("Open questions:");
    expect(tight.block.length).toBeLessThan(full.block.length);
  });

  it("skips what cannot fit at all", async () => {
    const result = await run("What did we decide on Tuesday's call?", {
      tokenBudget: 10,
    });
    expect(result.block).not.toContain("Beta launch planning");
  });

  it("only ever reads the workspace it is given", async () => {
    const mine = await run("What did we decide on Tuesday's call?");
    expect(mine.block).not.toContain("Secret board meeting");
    const theirs = await recall(
      otherWorkspaceId,
      understand("What did we decide on Tuesday's call?", NOW, TZ),
      { excludeMessageIds: new Set(), tz: TZ, now: NOW },
    );
    expect(theirs.block).toContain("Secret board meeting");
    expect(theirs.block).toContain("Acquire the competitor");
    expect(theirs.block).not.toContain("Beta launch planning");
  });
});
