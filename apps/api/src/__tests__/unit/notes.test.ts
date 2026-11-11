/**
 * @module api/__tests__/unit/notes
 * @description How the meeting notes request is built and read: the transcript
 * carries sequence tags, the instructions carry the meeting date, an unusable
 * reply is retried once with the validation error appended, and a second bad
 * reply fails the notes while keeping the transcript. The model client is a
 * stub; Postgres and Redis are real.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

import {
  buildNotesInstructions,
  buildTranscript,
  parseNotes,
  renderNotesMarkdown,
  writeNotes,
} from "../../lib/meeting/notes";
import {
  closeTestResources,
  createMeeting,
  createUser,
  createWorkspace,
  modelReply,
  resetDatabase,
  SAMPLE_LINES,
  sampleNotes,
  seedTranscript,
  stubResolver,
  testPrisma,
} from "@testhelpers";

afterAll(closeTestResources);

describe("buildTranscript", () => {
  it("renders [mm:ss] #seq Name: text per segment", () => {
    const text = buildTranscript([
      {
        seq: 12,
        speakerName: "Priya",
        text: "Hello",
        startMs: 65_000,
        endMs: 70_000,
      },
      {
        seq: 13,
        speakerName: "Tom",
        text: "Hi",
        startMs: 3_725_000,
        endMs: 3_730_000,
      },
    ]);
    expect(text).toBe("[01:05] #12 Priya: Hello\n[62:05] #13 Tom: Hi");
  });

  it("keeps the start and end of a very long transcript", () => {
    const segments = Array.from({ length: 4000 }, (_, i) => ({
      seq: i + 1,
      speakerName: "Priya",
      text: "x".repeat(100),
      startMs: i * 1000,
      endMs: i * 1000 + 900,
    }));
    const text = buildTranscript(segments);
    expect(text.length).toBeLessThan(160_000);
    expect(text).toContain("#1 Priya");
    expect(text).toContain("#4000 Priya");
    expect(text).toMatch(/\[\.\.\. \d+ lines omitted for length \.\.\.\]/);
  });
});

describe("buildNotesInstructions", () => {
  it("states the meeting date and its weekday", () => {
    const text = buildNotesInstructions(new Date("2026-11-09T10:00:00Z"));
    expect(text).toContain("2026-11-09");
    expect(text).toContain("Monday");
    expect(text).toContain("sourceSeq");
  });
});

describe("parseNotes", () => {
  it("reads valid notes, tolerating text around the JSON", () => {
    const result = parseNotes(`Here you go:\n${JSON.stringify(sampleNotes())}`);
    expect(result.ok).toBe(true);
  });

  it("reports why a reply is unusable", () => {
    expect(parseNotes("no json at all")).toEqual({
      ok: false,
      error: "the reply contained no JSON object",
    });
    const bad = parseNotes(
      JSON.stringify(sampleNotes({ title: "t".repeat(90) })),
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain("title");
  });
});

describe("renderNotesMarkdown", () => {
  it("renders every section with owners and due dates", () => {
    const markdown = renderNotesMarkdown(
      sampleNotes(),
      ["Tom Brandt", "Priya"],
      ["2026-11-13", null],
    );
    expect(markdown).toBe(`# Beta launch planning

## Summary

The team agreed to ship the beta on Friday.

## Decisions

- Ship the beta on Friday

## Action items

- [ ] Update the changelog (**Tom Brandt**, due 2026-11-13)
- [ ] Write the rollback plan (**Priya**)

## Open questions

- Who reviews the rollback plan?

Full transcript in Meetings.
`);
  });

  it("says so when a section is empty", () => {
    const markdown = renderNotesMarkdown(
      sampleNotes({ decisions: [], actionItems: [], openQuestions: [] }),
      [],
      [],
    );
    expect(markdown).toContain("## Decisions\n\n_None recorded._");
    expect(markdown).toContain("## Action items\n\n_None recorded._");
    expect(markdown).toContain("## Open questions\n\n_None._");
  });
});

describe("writeNotes against a stub model", () => {
  let meetingId: string;
  let workspaceId: string;

  beforeEach(async () => {
    createMock.mockReset();
    await resetDatabase();
    const starter = await createUser("Priya Shah");
    workspaceId = (await createWorkspace(starter.id)).id;
    const meeting = await createMeeting(workspaceId, {
      startedById: starter.id,
      status: "ENDED",
      startedAt: new Date("2026-11-09T09:00:00Z"),
      endedAt: new Date("2026-11-09T09:30:00Z"),
    });
    meetingId = meeting.id;
    await seedTranscript(meetingId, SAMPLE_LINES);
  });

  it("sends the seq-tagged transcript and the meeting date", async () => {
    createMock.mockResolvedValue(modelReply(sampleNotes()));

    const outcome = await writeNotes(meetingId, {
      resolve: stubResolver(createMock),
    });

    expect(outcome).toBe("written");
    expect(createMock).toHaveBeenCalledTimes(1);
    const request = createMock.mock.calls[0]![0] as {
      instructions: string;
      input: string;
      text: { format: { type: string } };
    };
    expect(request.input).toContain("#1 Priya Shah: Let us ship the beta");
    expect(request.input).toContain("#4 Tom Brandt:");
    expect(request.input).toContain("2026-11-09");
    expect(request.instructions).toContain("2026-11-09");
    expect(request.text.format.type).toBe("json_object");
  });

  it("retries once with the validation error appended", async () => {
    createMock
      .mockResolvedValueOnce(
        modelReply(sampleNotes({ title: "t".repeat(120) })),
      )
      .mockResolvedValueOnce(modelReply(sampleNotes()));

    const outcome = await writeNotes(meetingId, {
      resolve: stubResolver(createMock),
    });

    expect(outcome).toBe("written");
    expect(createMock).toHaveBeenCalledTimes(2);
    const retry = createMock.mock.calls[1]![0] as { input: string };
    expect(retry.input).toContain("Your previous reply was rejected");
    expect(retry.input).toContain("title");
    expect(retry.input).toContain("#1 Priya Shah");
  });

  it("retries after a reply that is not JSON", async () => {
    createMock
      .mockResolvedValueOnce(modelReply("Sorry, I cannot do that."))
      .mockResolvedValueOnce(modelReply(sampleNotes()));

    expect(
      await writeNotes(meetingId, { resolve: stubResolver(createMock) }),
    ).toBe("written");
    const retry = createMock.mock.calls[1]![0] as { input: string };
    expect(retry.input).toContain("no JSON object");
  });

  it("fails after a second bad reply, with the reason, keeping the transcript", async () => {
    createMock.mockResolvedValue(modelReply({ title: "only a title" }));

    const outcome = await writeNotes(meetingId, {
      resolve: stubResolver(createMock),
    });

    expect(outcome).toBe("failed");
    expect(createMock).toHaveBeenCalledTimes(2);
    const meeting = await testPrisma.meeting.findUniqueOrThrow({
      where: { id: meetingId },
    });
    expect(meeting.status).toBe("FAILED");
    expect(meeting.failureReason).toMatch(/^invalid-summary: /);
    expect(meeting.summary).toBeNull();
    expect(meeting.notesDocumentId).toBeNull();
    expect(
      await testPrisma.transcriptSegment.count({ where: { meetingId } }),
    ).toBe(4);
    expect(
      await testPrisma.document.count({ where: { type: "MARKDOWN" } }),
    ).toBe(0);
  });
});
