/**
 * @module web/tests/msw/meetingFixtures
 * @description Builders for the meeting DTOs the Meetings tab renders, with
 * overridable defaults, so each test states only what it cares about.
 */
import type {
  ActionItemDTO,
  MeetingDetailDTO,
  MeetingSummaryDTO,
  Member,
  SegmentDTO,
  Workspace,
} from "@nimbus/types";

export const WS = "cm_workspace_0000000000000";

export const members: Member[] = [
  { id: "user-1", name: "Ada Lovelace", image: null, role: "OWNER" },
  { id: "user-2", name: "Grace Hopper", image: null, role: "ADMIN" },
  { id: "user-3", name: "Alan Turing", image: null, role: "MEMBER" },
];

export const workspace: Workspace = {
  id: WS,
  name: "Design Guild",
  description: "Shared drafts",
  slug: "design-guild",
  slugId: 1,
  inviteCode: "invite-code",
  updatedAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
  members,
};

export const meetingRow = (
  overrides: Partial<MeetingSummaryDTO> = {},
): MeetingSummaryDTO => ({
  id: "m-1",
  workspaceId: WS,
  status: "ENDED",
  source: "BYOK",
  startedById: "user-1",
  startedAt: "2026-11-01T09:00:00.000Z",
  endedAt: "2026-11-01T09:12:00.000Z",
  endReason: "stopped",
  budgetSeconds: null,
  lastSeq: 2,
  startedByName: "Ada Lovelace",
  segmentCount: 2,
  title: null,
  notesDocumentId: null,
  ...overrides,
});

export const segment = (
  seq: number,
  text: string,
  overrides: Partial<SegmentDTO> = {},
): SegmentDTO => ({
  id: `s-${seq}`,
  meetingId: "m-1",
  seq,
  speakerUserId: "user-1",
  speakerName: "Ada Lovelace",
  text,
  startMs: seq * 65_000,
  endMs: seq * 65_000 + 2_000,
  language: null,
  ...overrides,
});

export const actionItem = (
  overrides: Partial<ActionItemDTO> = {},
): ActionItemDTO => ({
  id: "a-1",
  workspaceId: WS,
  meetingId: "m-1",
  meetingTitle: "Launch sync",
  text: "Send the launch checklist",
  ownerUserId: "user-2",
  ownerName: "Grace Hopper",
  dueDate: null,
  status: "OPEN",
  sourceSeq: 2,
  createdById: null,
  createdAt: "2026-11-01T09:13:00.000Z",
  updatedAt: "2026-11-01T09:13:00.000Z",
  completedAt: null,
  ...overrides,
});

export const meetingDetail = (
  overrides: Partial<MeetingDetailDTO> = {},
): MeetingDetailDTO => ({
  ...meetingRow({ status: "SUMMARIZED", title: "Launch sync" }),
  title: "Launch sync",
  startedByName: "Ada Lovelace",
  segmentCount: 2,
  summary: {
    title: "Launch sync",
    summary: "The team agreed to ship on Friday.",
    decisions: [{ text: "Ship on Friday", sourceSeq: 1 }],
    actionItems: [{ text: "Send the launch checklist", ownerName: "Grace" }],
    openQuestions: ["Who owns the changelog?"],
    topics: ["Launch", "Docs"],
  },
  decisions: [
    { id: "d-1", meetingId: "m-1", text: "Ship on Friday", sourceSeq: 1 },
  ],
  actionItems: [actionItem()],
  participants: [
    { userId: "user-1", name: "Ada Lovelace" },
    { userId: "user-2", name: "Grace Hopper" },
  ],
  notesDocumentId: "doc-notes-1",
  failureReason: null,
  ...overrides,
});
