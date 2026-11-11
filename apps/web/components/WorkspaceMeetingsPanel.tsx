"use client";

/**
 * @module web/components/WorkspaceMeetingsPanel
 * @description The workspace settings "Meetings" tab, open to every member. It
 * holds two views behind a switch: **Meetings** (a keyword search over every
 * transcript, then the paged list of calls NimbusBot was in, newest first, each
 * with its title, date, length, starter and status) and **Action items**
 * (everything assigned across meetings, filtered to mine, open or all).
 *
 * Opening a meeting, from the list, a search hit or an action item, replaces the
 * tab's content with its detail and a Back button; a hit opens the meeting at
 * the matching line. The tab follows the socket: statuses change as notes are
 * written, and a meeting deleted while open returns the reader to the list with
 * a notice.
 *
 * @important Search snippets are rendered as text and `<mark>` elements only
 *            (`MarkedSnippet`); the transcript text in them is never treated as
 *            markup.
 *
 * @important The viewer's role comes from the member list the settings dialog
 *            already holds. It only decides what to offer; the API re-checks
 *            every action.
 */
import type { Member, MeetingSummaryDTO } from "@nimbus/types";
import { useEffect, useState } from "react";
import { useMeetingSearch } from "../hooks/useMeetingSearch";
import { useWorkspaceMeetings } from "../hooks/useWorkspaceMeetings";
import {
  describeDuration,
  meetingTitle,
  statusLabel,
  statusTone,
  clock,
} from "../lib/meetingFormat";
import { socket } from "../lib/socket";
import ActionItemsView from "./meetings/ActionItemsView";
import MeetingDetail from "./meetings/MeetingDetail";
import MarkedSnippet from "./MarkedSnippet";
import Pagination from "./Pagination";

type View = "meetings" | "actions";

/** A meeting open in the tab, with the transcript line to land on. */
type Opened = { id: string; seq?: number };

/** One row of the meeting list. */
function MeetingRow({
  meeting,
  onOpen,
}: {
  meeting: MeetingSummaryDTO;
  onOpen: () => void;
}) {
  return (
    <li
      data-testid={`meeting-row-${meeting.id}`}
      className="rounded-xl border border-(--border) bg-(--muted)/20"
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:cursor-pointer"
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {meetingTitle(meeting)}
          </p>
          <p className="text-xs text-(--muted-foreground)">
            {new Date(meeting.startedAt).toLocaleString()}
            {` · ${describeDuration(meeting)}`}
            {meeting.startedByName
              ? ` · started by ${meeting.startedByName}`
              : ""}
            {` · ${meeting.segmentCount} ${meeting.segmentCount === 1 ? "line" : "lines"}`}
          </p>
        </div>
        <span
          data-testid="meeting-row-status"
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusTone(meeting.status)}`}
        >
          {statusLabel(meeting.status)}
        </span>
      </button>
    </li>
  );
}

/**
 * @param props.workspaceId - The workspace cuid.
 * @param props.userId - The signed-in user, whose caption language and role apply.
 * @param props.members - Workspace members, for owners and the viewer's role.
 */
export default function WorkspaceMeetingsPanel({
  workspaceId,
  userId,
  members = [],
}: {
  workspaceId: string;
  userId?: string;
  members?: Member[];
}) {
  const meetings = useWorkspaceMeetings(workspaceId);
  const search = useMeetingSearch(workspaceId);
  const [view, setView] = useState<View>("meetings");
  const [opened, setOpened] = useState<Opened | null>(null);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const role = members.find((member) => member.id === userId)?.role;
  const isAdmin = role === "OWNER" || role === "ADMIN";

  const openedId = opened?.id ?? null;
  useEffect(() => {
    if (!openedId) return;
    const onDeleted = ({ meetingId }: { meetingId: string }) => {
      if (meetingId !== openedId) return;
      setOpened(null);
      setNotice("That meeting was deleted.");
    };
    socket.on("meeting:deleted", onDeleted);
    return () => {
      socket.off("meeting:deleted", onDeleted);
    };
  }, [openedId]);

  const open = (id: string, seq?: number) => {
    setNotice(null);
    setOpened({ id, seq });
  };

  if (opened) {
    return (
      <div data-testid="workspace-meetings-panel">
        <MeetingDetail
          key={opened.id}
          meetingId={opened.id}
          members={members}
          userId={userId}
          isAdmin={isAdmin}
          focusSeq={opened.seq}
          onBack={() => setOpened(null)}
          onDeleted={() => {
            setOpened(null);
            setNotice("Meeting deleted.");
          }}
        />
      </div>
    );
  }

  const searching = search.state.kind !== "idle";

  return (
    <div className="space-y-4" data-testid="workspace-meetings-panel">
      <div
        role="group"
        aria-label="Meetings view"
        className="inline-flex rounded-xl border border-(--border) p-0.5"
      >
        {(
          [
            ["meetings", "Meetings"],
            ["actions", "Action items"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={view === value}
            onClick={() => setView(value)}
            className={`rounded-lg px-3 py-1 text-xs font-medium hover:cursor-pointer ${
              view === value
                ? "bg-(--primary)/15 text-(--primary)"
                : "text-(--muted-foreground) hover:text-(--foreground)"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {notice && (
        <p
          role="status"
          data-testid="meetings-notice"
          className="rounded-lg border border-(--border) bg-(--muted)/30 px-3 py-2 text-xs text-(--muted-foreground)"
        >
          {notice}
        </p>
      )}

      {view === "actions" ? (
        <ActionItemsView
          workspaceId={workspaceId}
          members={members}
          onOpenMeeting={(id) => open(id)}
        />
      ) : (
        <>
          <p className="text-sm text-(--muted-foreground)">
            Calls NimbusBot joined in this workspace, with the notes it wrote.
            Open one to read the notes and the transcript.
          </p>

          <form
            role="search"
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void search.search(query);
            }}
          >
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (!e.target.value.trim()) search.clear();
              }}
              placeholder="Search every transcript"
              aria-label="Search transcripts"
              maxLength={200}
              className="h-9 min-w-0 flex-1 rounded-xl border border-(--border) bg-(--muted)/50 px-3 text-sm"
            />
            <button
              type="submit"
              disabled={!query.trim()}
              className="rounded-xl bg-(--primary) px-4 text-xs font-semibold text-(--primary-foreground) hover:cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
            >
              Search
            </button>
          </form>

          {searching ? (
            <div data-testid="meeting-search-results" className="space-y-2">
              {search.state.kind === "loading" && (
                <p className="text-sm text-(--muted-foreground)">Searching…</p>
              )}
              {search.state.kind === "error" && (
                <p role="alert" className="text-xs text-(--destructive)">
                  {search.state.message}
                </p>
              )}
              {search.state.kind === "done" && (
                <>
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-(--muted-foreground)">
                      {search.state.hits.length === 0
                        ? `No transcript mentions "${search.state.query}".`
                        : `${search.state.hits.length} ${search.state.hits.length === 1 ? "match" : "matches"} for "${search.state.query}"`}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setQuery("");
                        search.clear();
                      }}
                      className="text-xs font-medium text-(--primary) hover:cursor-pointer hover:underline"
                    >
                      Clear search
                    </button>
                  </div>
                  <ul className="space-y-2">
                    {search.state.hits.map((hit) => (
                      <li key={hit.segmentId}>
                        <button
                          type="button"
                          data-testid={`search-hit-${hit.segmentId}`}
                          onClick={() => open(hit.meetingId, hit.seq)}
                          className="block w-full rounded-xl border border-(--border) bg-(--muted)/20 px-4 py-2 text-left hover:cursor-pointer hover:bg-(--muted)/40"
                        >
                          <span className="block text-xs font-medium">
                            {meetingTitle({
                              title: hit.meetingTitle,
                              startedAt: hit.meetingStartedAt,
                            })}
                            <span className="font-normal text-(--muted-foreground)">
                              {` · ${hit.speakerName} at ${clock(hit.startMs)}`}
                            </span>
                          </span>
                          <MarkedSnippet snippet={hit.snippet} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          ) : (
            <>
              {meetings.error && (
                <p
                  role="alert"
                  className="text-xs text-(--destructive)"
                  data-testid="meetings-error"
                >
                  {meetings.error}
                </p>
              )}

              {meetings.loading && meetings.meetings.length === 0 ? (
                <p className="text-sm text-(--muted-foreground)">
                  Loading meetings…
                </p>
              ) : meetings.meetings.length === 0 ? (
                <p
                  className="text-sm text-(--muted-foreground)"
                  data-testid="meetings-empty"
                >
                  No meetings yet. Start NimbusBot in a call to record one.
                </p>
              ) : (
                <ul
                  className={`space-y-2 transition-opacity ${meetings.loading ? "opacity-50" : ""}`}
                >
                  {meetings.meetings.map((meeting) => (
                    <MeetingRow
                      key={meeting.id}
                      meeting={meeting}
                      onOpen={() => open(meeting.id)}
                    />
                  ))}
                </ul>
              )}

              <Pagination
                testId="meetings-pagination"
                page={meetings.page}
                hasPrevious={meetings.hasPrevious}
                hasNext={meetings.hasNext}
                disabled={meetings.loading}
                onPrevious={() => void meetings.previousPage()}
                onNext={() => void meetings.nextPage()}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
