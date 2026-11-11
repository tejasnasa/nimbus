/**
 * @module web/components/meetings/ActionItemRow
 * @description One action item with its controls: a checkbox to mark it done,
 * the owner as a select over the workspace's members, and a due date with a
 * clear button. Used by both the meeting detail and the workspace action items
 * view, so the two behave identically.
 *
 * Each change is sent on its own and the row is disabled while it is saved. The
 * row never edits its own copy: the parent swaps in the server's item, so what
 * is on screen is what was stored.
 *
 * @important A spoken owner name that matched no member is shown as a note
 *            under the select ("Said: Bob") rather than lost, while the select
 *            reads "Unassigned" because no member owns the item yet.
 */
"use client";

import type { ActionItemDTO, Member } from "@nimbus/types";
import Select from "@nimbus/ui/Select";
import type { ActionItemChange } from "../../lib/meetingApi";

/** Today as `YYYY-MM-DD` in the viewer's calendar. */
function today(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * @param props.item - The action item.
 * @param props.members - Workspace members the owner can be picked from.
 * @param props.pending - Whether a change to this item is being saved.
 * @param props.onChange - Saves a change to the item.
 * @param props.onOpenMeeting - When given, shows a link to the item's meeting.
 */
export default function ActionItemRow({
  item,
  members,
  pending,
  onChange,
  onOpenMeeting,
}: {
  item: ActionItemDTO;
  members: Member[];
  pending: boolean;
  onChange: (itemId: string, change: ActionItemChange) => void;
  onOpenMeeting?: (meetingId: string) => void;
}) {
  const done = item.status === "DONE";
  const overdue = !done && item.dueDate !== null && item.dueDate < today();
  const unmatchedName = item.ownerUserId === null ? item.ownerName : null;

  return (
    <li
      data-testid={`action-item-${item.id}`}
      data-status={item.status}
      className="rounded-xl border border-(--border) bg-(--muted)/20 p-3"
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={done}
          disabled={pending}
          aria-label={`Mark "${item.text}" ${done ? "not done" : "done"}`}
          onChange={() => onChange(item.id, { status: done ? "OPEN" : "DONE" })}
          className="mt-0.5 h-4 w-4 shrink-0 accent-(--primary) hover:cursor-pointer disabled:cursor-not-allowed"
        />
        <div className="min-w-0 flex-1 space-y-2">
          <p
            className={`text-sm ${done ? "text-(--muted-foreground) line-through" : ""}`}
          >
            {item.text}
          </p>
          {onOpenMeeting && item.meetingId && (
            <button
              type="button"
              onClick={() => onOpenMeeting(item.meetingId!)}
              className="text-xs text-(--primary) hover:cursor-pointer hover:underline"
            >
              From {item.meetingTitle ?? "an untitled meeting"}
            </button>
          )}
          <div className="flex flex-wrap items-end gap-3">
            <Select
              id={`owner-${item.id}`}
              label="Owner"
              value={item.ownerUserId ?? ""}
              disabled={pending}
              onChange={(value) =>
                onChange(item.id, { ownerUserId: value || null })
              }
              options={[
                { value: "", label: "Unassigned" },
                ...members.map((member) => ({
                  value: member.id,
                  label: member.name,
                })),
              ]}
              className="w-44"
              triggerClassName="h-8 rounded-lg text-xs"
            />
            <div className="flex flex-col gap-1">
              <label htmlFor={`due-${item.id}`} className="text-xs font-medium">
                Due date
              </label>
              <div className="flex items-center gap-1">
                <input
                  id={`due-${item.id}`}
                  type="date"
                  value={item.dueDate ?? ""}
                  disabled={pending}
                  onChange={(e) =>
                    onChange(item.id, { dueDate: e.target.value || null })
                  }
                  className={`h-8 rounded-lg border bg-(--muted)/50 px-2 text-xs ${overdue ? "border-(--destructive)/60" : "border-(--border)"}`}
                />
                {item.dueDate && (
                  <button
                    type="button"
                    disabled={pending}
                    aria-label={`Clear due date for "${item.text}"`}
                    onClick={() => onChange(item.id, { dueDate: null })}
                    className="rounded-lg px-2 py-1 text-xs text-(--muted-foreground) hover:cursor-pointer hover:bg-(--muted) disabled:cursor-not-allowed"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          </div>
          {unmatchedName && (
            <p className="text-xs text-(--muted-foreground)">
              Said: {unmatchedName}
            </p>
          )}
          {overdue && <p className="text-xs text-(--destructive)">Overdue</p>}
        </div>
      </div>
    </li>
  );
}
