/**
 * @module web/hooks/useMeetingActions
 * @description The two things a member can do to an ended meeting from its
 * detail view: ask NimbusBot to draw the discussion as a canvas, and delete the
 * meeting.
 *
 * Drawing only starts the work (the API answers 202); the progress and the
 * resulting document arrive through the editor's document generation events. A
 * refusal (no key, free quota used) keeps the server's message so it can be
 * shown beside the button.
 */
import { useCallback, useState } from "react";
import { deleteMeeting, drawMeetingDiagram } from "../lib/meetingApi";

export type ActionState =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "done"; message: string }
  | { kind: "error"; message: string };

const IDLE: ActionState = { kind: "idle" };

/** @param meetingId - The meeting the actions apply to. */
export function useMeetingActions(meetingId: string) {
  const [diagram, setDiagram] = useState<ActionState>(IDLE);
  const [removal, setRemoval] = useState<ActionState>(IDLE);

  const draw = useCallback(async () => {
    setDiagram({ kind: "pending" });
    const result = await drawMeetingDiagram(meetingId);
    setDiagram(
      result.ok
        ? {
            kind: "done",
            message: `Drawing "${result.data.label}". Close settings to watch it appear.`,
          }
        : { kind: "error", message: result.message },
    );
  }, [meetingId]);

  const remove = useCallback(async (): Promise<boolean> => {
    setRemoval({ kind: "pending" });
    const result = await deleteMeeting(meetingId);
    setRemoval(
      result.ok
        ? { kind: "done", message: "Meeting deleted" }
        : { kind: "error", message: result.message },
    );
    return result.ok;
  }, [meetingId]);

  return { diagram, draw, removal, remove };
}
