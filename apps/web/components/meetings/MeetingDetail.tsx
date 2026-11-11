/**
 * @module web/components/meetings/MeetingDetail
 * @description One meeting inside the Meetings tab: who was there and how long
 * it ran, the notes (summary, decisions, action items, open questions, topics),
 * a button to open the notes document, "Draw this discussion", delete, and the
 * full transcript with a speaker colour and timestamp per line and a language
 * select for stored translations.
 *
 * The transcript opens in the viewer's caption language and the select
 * overrides it for this view only. Arriving from a search hit scrolls to and
 * marks the matching line once the transcript has loaded.
 *
 * The delete confirmation stops its clicks from reaching the settings dialog
 * around it, whose own close-on-click handling would otherwise dismiss the
 * whole settings dialog along with the confirmation.
 *
 * Delete is offered to admins and to whoever started the meeting, and never
 * while the meeting is live; a disabled button says why. The API enforces the
 * same rules, so a stale role on screen cannot do more than the server allows.
 *
 * @important The notes sections come from `MeetingDetailDTO.summary`, which is
 *            null until they are written; "Draw this discussion" is disabled
 *            until then because the diagram is built from the notes.
 */
"use client";

import type { MeetingDetailDTO, Member, SegmentDTO } from "@nimbus/types";
import AlertDialog from "@nimbus/ui/AlertDialog";
import Button from "@nimbus/ui/Button";
import Delete from "@nimbus/ui/icons/Delete";
import Select from "@nimbus/ui/Select";
import { CAPTION_LANGUAGES } from "@nimbus/utils";
import { useEffect, useRef, useState } from "react";
import { useCaptionPrefs } from "../../hooks/useCaptionPrefs";
import { useActionItemEditor } from "../../hooks/useActionItems";
import { useMeetingActions } from "../../hooks/useMeetingActions";
import { useMeetingDetail } from "../../hooks/useMeetingDetail";
import { useMeetingTranscript } from "../../hooks/useMeetingTranscript";
import { useOpenDocument } from "../../hooks/useOpenDocument";
import {
  clock,
  describeDuration,
  meetingTitle,
  speakerColor,
  statusLabel,
  statusTone,
} from "../../lib/meetingFormat";
import { useOptionalWorkspaceSettings } from "../WorkspaceSettingsContext";
import ActionItemRow from "./ActionItemRow";

const ORIGINAL = "original";

const LANGUAGE_OPTIONS = [
  { value: ORIGINAL, label: "Original (no translation)" },
  ...CAPTION_LANGUAGES.map(({ code, label }) => ({ value: code, label })),
];

/** Why the viewer cannot delete this meeting, or null when they can. */
function deleteBlockedReason(
  meeting: MeetingDetailDTO,
  mayDelete: boolean,
): string | null {
  if (meeting.status === "LIVE") return "End the meeting before deleting it.";
  if (!mayDelete) {
    return "Only an admin or whoever started the meeting can delete it.";
  }
  return null;
}

/**
 * @param props.meetingId - The meeting to show.
 * @param props.members - Workspace members, for the owner select.
 * @param props.userId - The signed-in user, whose caption language and
 *                       permissions apply.
 * @param props.isAdmin - Whether the viewer is an owner or admin.
 * @param props.focusSeq - A transcript line to scroll to and mark.
 * @param props.onBack - Returns to the list.
 * @param props.onDeleted - Called once the meeting was deleted.
 */
export default function MeetingDetail({
  meetingId,
  members,
  userId,
  isAdmin,
  focusSeq,
  onBack,
  onDeleted,
}: {
  meetingId: string;
  members: Member[];
  userId?: string;
  isAdmin: boolean;
  focusSeq?: number;
  onBack: () => void;
  onDeleted: (meetingId: string) => void;
}) {
  const { state, replaceActionItem } = useMeetingDetail(meetingId);
  const { prefs } = useCaptionPrefs(userId);
  const [confirming, setConfirming] = useState(false);
  const [chosen, setChosen] = useState<string | null | undefined>(undefined);
  const language = chosen === undefined ? prefs.language : chosen;

  const editor = useActionItemEditor(replaceActionItem);
  const actions = useMeetingActions(meetingId);
  const notes = useOpenDocument();
  const settings = useOptionalWorkspaceSettings();

  const live = state.kind === "ready" && state.detail.status === "LIVE";
  const transcript = useMeetingTranscript(meetingId, language, live);

  const focusRef = useRef<HTMLLIElement | null>(null);
  const transcriptReady = transcript.state.kind === "ready";
  useEffect(() => {
    if (transcriptReady && focusSeq !== undefined) {
      focusRef.current?.scrollIntoView?.({ block: "center" });
    }
  }, [transcriptReady, focusSeq]);

  const back = (
    <button
      type="button"
      onClick={onBack}
      className="text-xs font-medium text-(--primary) hover:cursor-pointer hover:underline"
    >
      ← Back to meetings
    </button>
  );

  if (state.kind === "loading") {
    return (
      <div className="space-y-3" data-testid="meeting-detail">
        {back}
        <p className="text-sm text-(--muted-foreground)">Loading meeting…</p>
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="space-y-3" data-testid="meeting-detail">
        {back}
        <p role="alert" className="text-xs text-(--destructive)">
          {state.message}
        </p>
      </div>
    );
  }

  const meeting = state.detail;
  const summary = meeting.summary;
  const blocked = deleteBlockedReason(
    meeting,
    isAdmin || (userId !== undefined && meeting.startedById === userId),
  );

  const openNotes = async () => {
    if (!meeting.notesDocumentId) return;
    if (await notes.open(meeting.notesDocumentId)) settings?.close();
  };

  return (
    <div className="space-y-5" data-testid="meeting-detail">
      {back}

      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">{meetingTitle(meeting)}</h2>
          <span
            data-testid="meeting-status"
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusTone(meeting.status)}`}
          >
            {statusLabel(meeting.status)}
          </span>
        </div>
        <p className="text-xs text-(--muted-foreground)">
          {new Date(meeting.startedAt).toLocaleString()} ·{" "}
          {describeDuration(meeting)}
          {meeting.startedByName
            ? ` · started by ${meeting.startedByName}`
            : ""}
          {` · ${meeting.segmentCount} ${meeting.segmentCount === 1 ? "line" : "lines"}`}
        </p>
        {meeting.participants.length > 0 && (
          <p
            className="text-xs text-(--muted-foreground)"
            data-testid="meeting-participants"
          >
            With {meeting.participants.map((p) => p.name).join(", ")}
          </p>
        )}
      </header>

      {meeting.status === "ENDED" && (
        <p role="status" className="text-sm text-(--muted-foreground)">
          NimbusBot is writing the notes. They appear here when they are ready.
        </p>
      )}
      {meeting.status === "FAILED" && (
        <p role="alert" className="text-sm text-(--destructive)">
          {meeting.failureReason ?? "The notes could not be written."} The
          transcript below is kept.
        </p>
      )}

      {summary && (
        <section className="space-y-4" aria-label="Notes">
          <div>
            <h3 className="mb-1 text-sm font-semibold">Summary</h3>
            <p className="whitespace-pre-wrap text-sm">{summary.summary}</p>
          </div>

          {meeting.decisions.length > 0 && (
            <div>
              <h3 className="mb-1 text-sm font-semibold">Decisions</h3>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {meeting.decisions.map((decision) => (
                  <li key={decision.id}>{decision.text}</li>
                ))}
              </ul>
            </div>
          )}

          {summary.openQuestions.length > 0 && (
            <div>
              <h3 className="mb-1 text-sm font-semibold">Open questions</h3>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {summary.openQuestions.map((question) => (
                  <li key={question}>{question}</li>
                ))}
              </ul>
            </div>
          )}

          {summary.topics.length > 0 && (
            <div>
              <h3 className="mb-1 text-sm font-semibold">Topics</h3>
              <ul className="flex flex-wrap gap-1.5">
                {summary.topics.map((topic) => (
                  <li
                    key={topic}
                    className="rounded-full bg-(--muted) px-2 py-0.5 text-xs"
                  >
                    {topic}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {(meeting.actionItems.length > 0 || summary) && (
        <section aria-label="Action items" className="space-y-2">
          <h3 className="text-sm font-semibold">Action items</h3>
          {editor.error && (
            <p role="alert" className="text-xs text-(--destructive)">
              {editor.error}
            </p>
          )}
          {meeting.actionItems.length === 0 ? (
            <p className="text-sm text-(--muted-foreground)">
              No action items came out of this meeting.
            </p>
          ) : (
            <ul className="space-y-2" data-testid="meeting-action-items">
              {meeting.actionItems.map((item) => (
                <ActionItemRow
                  key={item.id}
                  item={item}
                  members={members}
                  pending={editor.pendingId === item.id}
                  onChange={(id, change) => void editor.update(id, change)}
                />
              ))}
            </ul>
          )}
        </section>
      )}

      <section aria-label="Meeting actions" className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {meeting.notesDocumentId && (
            <Button
              size="sm"
              type="button"
              data-testid="open-notes"
              loading={notes.opening !== null}
              onClick={() => void openNotes()}
              className="rounded-xl"
            >
              Open notes document
            </Button>
          )}
          <Button
            size="sm"
            type="button"
            data-testid="draw-diagram"
            disabled={summary === null || actions.diagram.kind === "pending"}
            loading={actions.diagram.kind === "pending"}
            onClick={() => void actions.draw()}
            className="rounded-xl bg-transparent border border-(--border) text-(--foreground) hover:bg-(--muted)"
          >
            Draw this discussion
          </Button>
          {blocked ? (
            <Button
              size="sm"
              type="button"
              disabled
              aria-describedby="delete-meeting-reason"
              data-testid="delete-meeting"
              className="rounded-xl bg-(--destructive) disabled:bg-(--destructive)/40"
            >
              Delete meeting
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                type="button"
                data-testid="delete-meeting"
                onClick={() => setConfirming(true)}
                className="rounded-xl bg-(--destructive) hover:bg-(--destructive)/80"
              >
                Delete meeting
              </Button>
              <AlertDialog open={confirming} onOpenChange={setConfirming}>
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="relative z-50 w-100 rounded-2xl border border-(--border) bg-(--card) shadow-2xl p-6"
                >
                  <div className="mb-4 flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-(--destructive)/15">
                      <Delete className="h-5 w-5 text-(--destructive)" />
                    </div>
                    <h3 className="font-semibold">Delete meeting</h3>
                  </div>
                  <p className="mb-6 text-sm text-(--muted-foreground)">
                    Delete this meeting with its transcript and notes? Its
                    action items stay in the workspace. This cannot be undone.
                  </p>
                  <div className="flex justify-end gap-3">
                    <Button
                      size="sm"
                      type="button"
                      onClick={() => setConfirming(false)}
                      className="rounded-xl border border-(--border) bg-transparent text-(--foreground) hover:bg-(--muted)"
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      type="button"
                      data-testid="confirm-delete-meeting"
                      onClick={() => {
                        setConfirming(false);
                        void actions.remove().then((deleted) => {
                          if (deleted) onDeleted(meetingId);
                        });
                      }}
                      className="rounded-xl bg-(--destructive) hover:bg-(--destructive)/80"
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              </AlertDialog>
            </>
          )}
        </div>
        {summary === null && (
          <p className="text-xs text-(--muted-foreground)">
            Drawing is available once the notes are written.
          </p>
        )}
        {blocked && (
          <p
            id="delete-meeting-reason"
            className="text-xs text-(--muted-foreground)"
          >
            {blocked}
          </p>
        )}
        {actions.diagram.kind === "error" && (
          <p role="alert" className="text-xs text-(--destructive)">
            {actions.diagram.message}
          </p>
        )}
        {actions.diagram.kind === "done" && (
          <p role="status" className="text-xs text-(--muted-foreground)">
            {actions.diagram.message}
          </p>
        )}
        {actions.removal.kind === "error" && (
          <p
            role="alert"
            data-testid="delete-error"
            className="text-xs text-(--destructive)"
          >
            {actions.removal.message}
          </p>
        )}
        {notes.error && (
          <p role="alert" className="text-xs text-(--destructive)">
            {notes.error}
          </p>
        )}
      </section>

      <section aria-label="Transcript" className="space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h3 className="text-sm font-semibold">Transcript</h3>
          <Select
            id="meeting-transcript-language"
            label="Transcript language"
            value={language ?? ORIGINAL}
            onChange={(value) => setChosen(value === ORIGINAL ? null : value)}
            options={LANGUAGE_OPTIONS}
            className="w-56"
            triggerClassName="h-8 rounded-lg text-xs"
          />
        </div>
        <Transcript
          state={transcript.state}
          focusSeq={focusSeq}
          focusRef={focusRef}
          onRetry={transcript.retry}
        />
      </section>
    </div>
  );
}

/** The meeting's lines, or its loading and error states. */
function Transcript({
  state,
  focusSeq,
  focusRef,
  onRetry,
}: {
  state: ReturnType<typeof useMeetingTranscript>["state"];
  focusSeq: number | undefined;
  focusRef: React.RefObject<HTMLLIElement | null>;
  onRetry: () => void;
}) {
  if (state.kind === "loading") {
    return (
      <p className="text-xs text-(--muted-foreground)">Loading transcript…</p>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="space-y-1">
        <p role="alert" className="text-xs text-(--destructive)">
          {state.message}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="text-xs font-medium text-(--primary) hover:cursor-pointer hover:underline"
        >
          Try again
        </button>
      </div>
    );
  }
  if (state.segments.length === 0) {
    return (
      <p className="text-xs text-(--muted-foreground)">
        Nothing was transcribed in this meeting.
      </p>
    );
  }
  return (
    <ol
      className="max-h-96 space-y-1.5 overflow-y-auto rounded-xl border border-(--border) px-4 py-3 text-xs scrollbar-thin"
      data-testid="transcript-lines"
    >
      {state.segments.map((segment: SegmentDTO) => {
        const focused = segment.seq === focusSeq;
        return (
          <li
            key={segment.id}
            data-seq={segment.seq}
            ref={focused ? focusRef : undefined}
            aria-current={focused ? "true" : undefined}
            className={`flex gap-3 rounded-md px-1 ${focused ? "bg-(--primary)/15" : ""}`}
          >
            <span className="w-10 shrink-0 font-mono text-(--muted-foreground)">
              {clock(segment.startMs)}
            </span>
            <p
              title={
                segment.translation ? `Original: ${segment.text}` : undefined
              }
            >
              <span
                className="font-semibold"
                style={{ color: speakerColor(segment.speakerName) }}
              >
                {segment.speakerName}:
              </span>{" "}
              {segment.translation ?? segment.text}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
