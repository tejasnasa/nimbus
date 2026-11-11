/**
 * @module web/components/meetings/ActionItemsView
 * @description The Meetings tab's "Action items" view: every action item in the
 * workspace, filtered to the viewer's own, to everything still open, or to all
 * of them, paged with Previous and Next. Each row has the same controls as in a
 * meeting's detail, and a link back to the meeting it came from.
 */
"use client";

import type { Member } from "@nimbus/types";
import { useState } from "react";
import {
  useActionItemEditor,
  useActionItems,
  type ActionItemScope,
} from "../../hooks/useActionItems";
import Pagination from "../Pagination";
import ActionItemRow from "./ActionItemRow";

const SCOPES: Array<{ value: ActionItemScope; label: string }> = [
  { value: "mine", label: "Mine" },
  { value: "open", label: "Open" },
  { value: "all", label: "All" },
];

const EMPTY_COPY: Record<ActionItemScope, string> = {
  mine: "Nothing is assigned to you.",
  open: "No open action items.",
  all: "No action items yet. They appear after NimbusBot writes up a meeting.",
};

/**
 * @param props.workspaceId - The workspace cuid.
 * @param props.members - Workspace members, for the owner select.
 * @param props.onOpenMeeting - Opens an item's meeting.
 */
export default function ActionItemsView({
  workspaceId,
  members,
  onOpenMeeting,
}: {
  workspaceId: string;
  members: Member[];
  onOpenMeeting: (meetingId: string) => void;
}) {
  const [scope, setScope] = useState<ActionItemScope>("mine");
  const list = useActionItems(workspaceId, scope);
  const editor = useActionItemEditor(list.replaceItem);

  return (
    <div className="space-y-3" data-testid="action-items-view">
      <div
        role="group"
        aria-label="Filter action items"
        className="inline-flex rounded-xl border border-(--border) p-0.5"
      >
        {SCOPES.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={scope === option.value}
            onClick={() => setScope(option.value)}
            className={`rounded-lg px-3 py-1 text-xs font-medium hover:cursor-pointer ${
              scope === option.value
                ? "bg-(--primary)/15 text-(--primary)"
                : "text-(--muted-foreground) hover:text-(--foreground)"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {(list.error || editor.error) && (
        <p
          role="alert"
          className="text-xs text-(--destructive)"
          data-testid="action-items-error"
        >
          {list.error ?? editor.error}
        </p>
      )}

      {list.loading && list.items.length === 0 ? (
        <p className="text-sm text-(--muted-foreground)">
          Loading action items…
        </p>
      ) : list.items.length === 0 ? (
        <p
          className="text-sm text-(--muted-foreground)"
          data-testid="action-items-empty"
        >
          {EMPTY_COPY[scope]}
        </p>
      ) : (
        <ul
          className={`space-y-2 transition-opacity ${list.loading ? "opacity-50" : ""}`}
        >
          {list.items.map((item) => (
            <ActionItemRow
              key={item.id}
              item={item}
              members={members}
              pending={editor.pendingId === item.id}
              onChange={(id, change) => void editor.update(id, change)}
              onOpenMeeting={onOpenMeeting}
            />
          ))}
        </ul>
      )}

      <Pagination
        testId="action-items-pagination"
        page={list.page}
        hasPrevious={list.hasPrevious}
        hasNext={list.hasNext}
        disabled={list.loading}
        onPrevious={() => void list.previousPage()}
        onNext={() => void list.nextPage()}
      />
    </div>
  );
}
