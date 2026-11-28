/**
 * @module web/components/meetings/ActionItemRow
 * @description One action item as a compact card: a checkbox to mark it done,
 * its text (reworded in place) with edit and delete icons beside it, and a row
 * of chips under it for the owner (a select over the workspace's members), the
 * due date (with a clear button, tinted and tagged "Overdue" once it has
 * passed), a spoken owner nobody matched, and the meeting it came from. Delete
 * asks once before it acts. Used by both the meeting detail and the workspace action
 * items view, so the two behave identically.
 *
 * Each change is sent on its own and the row is disabled while it is saved. The
 * row never edits its own copy: the parent swaps in the server's item, so what
 * is on screen is what was stored.
 *
 * @important A spoken owner name that matched no member is shown as a chip
 *            beside the select ("Said: Bob") rather than lost, while the select
 *            reads "Unassigned" because no member owns the item yet.
 *
 * @important Delete is shown only to someone the API lets delete the item (an
 *            admin, its owner or its creator); the API still decides.
 */
"use client";

import {
  ACTION_ITEM_TEXT_MAX,
  type ActionItemDTO,
  type Member,
} from "@nimbus/types";
import Delete from "@nimbus/ui/icons/Delete";
import Edit from "@nimbus/ui/icons/Edit";
import Select from "@nimbus/ui/Select";
import { useState } from "react";
import type { ActionItemChange } from "../../lib/meetingApi";

/** Today as `YYYY-MM-DD` in the viewer's calendar. */
function today(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

const CHIP =
  "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs";
const ICON_BUTTON =
  "grid size-7 shrink-0 place-items-center rounded-lg text-(--muted-foreground) transition-colors hover:cursor-pointer disabled:cursor-not-allowed disabled:opacity-50";

/**
 * @param props.item - The action item.
 * @param props.members - Workspace members the owner can be picked from.
 * @param props.pending - Whether a change to this item is being saved.
 * @param props.onChange - Saves a change to the item.
 * @param props.onOpenMeeting - When given, shows a link to the item's meeting.
 * @param props.onDelete - When given, shows a delete button for the item.
 */
export default function ActionItemRow({
  item,
  members,
  pending,
  onChange,
  onOpenMeeting,
  onDelete,
}: {
  item: ActionItemDTO;
  members: Member[];
  pending: boolean;
  onChange: (itemId: string, change: ActionItemChange) => void;
  onOpenMeeting?: (meetingId: string) => void;
  onDelete?: (itemId: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const done = item.status === "DONE";
  const overdue = !done && item.dueDate !== null && item.dueDate < today();
  const unmatchedName = item.ownerUserId === null ? item.ownerName : null;

  const saveText = () => {
    const text = draft?.trim() ?? "";
    setDraft(null);
    if (text && text !== item.text) onChange(item.id, { text });
  };

  return (
    <li
      data-testid={`action-item-${item.id}`}
      data-status={item.status}
      className={`group rounded-[14px] border bg-(--panel) px-4 py-3.5 transition-colors ${
        overdue
          ? "border-(--destructive)/30"
          : "border-(--line-2) hover:border-(--line-3)"
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="relative mt-0.5 grid size-5 shrink-0 place-items-center">
          <input
            type="checkbox"
            checked={done}
            disabled={pending}
            aria-label={`Mark "${item.text}" ${done ? "not done" : "done"}`}
            onChange={() =>
              onChange(item.id, { status: done ? "OPEN" : "DONE" })
            }
            className="peer size-5 appearance-none rounded-md border-[1.5px] border-(--line-3) bg-(--surface-1) transition-colors checked:border-(--lime) checked:bg-(--lime) hover:cursor-pointer hover:border-(--violet) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--violet) disabled:cursor-not-allowed disabled:opacity-60"
          />
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className="pointer-events-none absolute size-3.5 text-(--ink) opacity-0 peer-checked:opacity-100"
            fill="none"
            stroke="currentColor"
            strokeWidth="3.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        </span>

        <div className="min-w-0 flex-1">
          {draft !== null ? (
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                saveText();
              }}
            >
              <input
                autoFocus
                aria-label="Action item text"
                value={draft}
                maxLength={ACTION_ITEM_TEXT_MAX}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setDraft(null);
                }}
                className="h-9 min-w-0 flex-1 rounded-[10px] border border-(--violet)/50 bg-(--surface-1) px-3 text-sm outline-none focus:border-(--violet)"
              />
              <button
                type="submit"
                disabled={!draft.trim()}
                className="h-9 rounded-[10px] bg-(--primary) px-3.5 text-xs font-semibold text-white hover:cursor-pointer hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="h-9 rounded-[10px] px-3 text-xs text-(--muted-foreground) hover:cursor-pointer hover:bg-(--surface-3)"
              >
                Cancel
              </button>
            </form>
          ) : (
            <div className="flex items-start gap-2">
              <p
                className={`min-w-0 flex-1 text-[15px] font-medium leading-snug ${
                  done ? "text-(--muted-foreground) line-through" : ""
                }`}
              >
                {item.text}
              </p>
              <div className="-mt-0.5 flex shrink-0 items-center gap-0.5 opacity-60 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                <button
                  type="button"
                  disabled={pending}
                  aria-label={`Edit "${item.text}"`}
                  title="Edit"
                  onClick={() => setDraft(item.text)}
                  className={`${ICON_BUTTON} hover:bg-(--surface-3) hover:text-(--foreground)`}
                >
                  <Edit className="size-3.5" />
                </button>
                {onDelete && !confirmingDelete && (
                  <button
                    type="button"
                    disabled={pending}
                    aria-label={`Delete "${item.text}"`}
                    title="Delete"
                    onClick={() => setConfirmingDelete(true)}
                    className={`${ICON_BUTTON} hover:bg-(--destructive)/10 hover:text-(--destructive)`}
                  >
                    <Delete className="size-3.5" />
                  </button>
                )}
              </div>
            </div>
          )}

          {onDelete && confirmingDelete && (
            <div
              role="group"
              aria-label="Confirm delete"
              className="mt-2.5 flex flex-wrap items-center gap-2 rounded-[10px] border border-(--destructive)/25 bg-(--destructive)/8 px-3 py-2 text-xs"
            >
              <span className="mr-auto text-(--text-body)">
                Delete this action item?
              </span>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="rounded-lg px-2.5 py-1 text-(--muted-foreground) hover:cursor-pointer hover:bg-(--surface-3)"
              >
                Keep it
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setConfirmingDelete(false);
                  onDelete(item.id);
                }}
                className="rounded-lg bg-red-600 px-2.5 py-1 font-semibold text-white hover:cursor-pointer hover:bg-red-600/85 disabled:cursor-not-allowed"
              >
                Delete
              </button>
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
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
              className="w-40 gap-0! [&>span:first-child]:sr-only"
              triggerClassName="h-8! rounded-full! border-(--line-2)! bg-(--surface-3)! pl-3! pr-8! text-xs!"
            />

            <div
              className={`${CHIP} ${
                overdue
                  ? "border-(--destructive)/40 bg-(--destructive)/10 text-red-300"
                  : "border-(--line-2) bg-(--surface-3)"
              }`}
            >
              <label htmlFor={`due-${item.id}`} className="sr-only">
                Due date
              </label>
              <input
                id={`due-${item.id}`}
                type="date"
                value={item.dueDate ?? ""}
                disabled={pending}
                onChange={(e) =>
                  onChange(item.id, { dueDate: e.target.value || null })
                }
                className={`bg-transparent text-xs scheme-dark outline-none hover:cursor-pointer disabled:cursor-not-allowed ${
                  item.dueDate ? "" : "text-(--muted-foreground)"
                }`}
              />
              {overdue && (
                <span className="rounded-full bg-(--destructive)/20 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide">
                  Overdue
                </span>
              )}
              {item.dueDate && (
                <button
                  type="button"
                  disabled={pending}
                  aria-label={`Clear due date for "${item.text}"`}
                  title="Clear due date"
                  onClick={() => onChange(item.id, { dueDate: null })}
                  className="-mr-1 grid size-5 place-items-center rounded-full text-sm leading-none opacity-70 hover:cursor-pointer hover:bg-(--surface-4) hover:opacity-100 disabled:cursor-not-allowed"
                >
                  ×
                </button>
              )}
            </div>

            {unmatchedName && (
              <span
                className={`${CHIP} border-dashed border-(--line-3) text-(--muted-foreground)`}
              >
                Said: {unmatchedName}
              </span>
            )}

            {onOpenMeeting && item.meetingId && (
              <button
                type="button"
                onClick={() => onOpenMeeting(item.meetingId!)}
                className={`${CHIP} min-w-0 max-w-full border-(--violet)/25 bg-(--violet)/10 text-(--violet-soft) hover:cursor-pointer hover:bg-(--violet)/20`}
              >
                <span className="truncate">
                  From {item.meetingTitle ?? "an untitled meeting"}
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}
