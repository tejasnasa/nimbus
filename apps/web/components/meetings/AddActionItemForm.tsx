/**
 * @module web/components/meetings/AddActionItemForm
 * @description A one-line form for adding an action item by hand: what needs
 * doing, and optionally an owner from the workspace's members and a due date.
 * Used by the workspace action items view and by a meeting's detail, where the
 * new item belongs to that meeting.
 *
 * The fields clear only once the item is stored, so a failed add keeps what was
 * typed for another try.
 */
"use client";

import { ACTION_ITEM_TEXT_MAX, type Member } from "@nimbus/types";
import Button from "@nimbus/ui/Button";
import Select from "@nimbus/ui/Select";
import { useState } from "react";
import type { NewActionItem } from "../../lib/meetingApi";

/**
 * @param props.members - Workspace members the owner can be picked from.
 * @param props.adding - Whether an add is being saved.
 * @param props.onAdd - Saves the item; resolves to whether it was stored.
 */
export default function AddActionItemForm({
  members,
  adding,
  onAdd,
}: {
  members: Member[];
  adding: boolean;
  onAdd: (
    item: Pick<NewActionItem, "text" | "ownerUserId" | "dueDate">,
  ) => Promise<boolean>;
}) {
  const [text, setText] = useState("");
  const [ownerUserId, setOwnerUserId] = useState("");
  const [dueDate, setDueDate] = useState("");

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed || adding) return;
    const stored = await onAdd({
      text: trimmed,
      ownerUserId: ownerUserId || null,
      dueDate: dueDate || null,
    });
    if (stored) {
      setText("");
      setOwnerUserId("");
      setDueDate("");
    }
  };

  return (
    <form
      data-testid="add-action-item"
      aria-label="Add an action item"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-(--border) p-3"
    >
      <div className="flex min-w-48 flex-1 flex-col gap-1">
        <label htmlFor="new-action-item-text" className="text-xs font-medium">
          New action item
        </label>
        <input
          id="new-action-item-text"
          value={text}
          maxLength={ACTION_ITEM_TEXT_MAX}
          placeholder="What needs doing?"
          onChange={(e) => setText(e.target.value)}
          className="h-8 rounded-lg border border-(--border) bg-(--muted)/50 px-2 text-sm"
        />
      </div>
      <Select
        id="new-action-item-owner"
        label="Owner"
        value={ownerUserId}
        onChange={setOwnerUserId}
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
        <label htmlFor="new-action-item-due" className="text-xs font-medium">
          Due date
        </label>
        <input
          id="new-action-item-due"
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="h-8 rounded-lg border border-(--border) bg-(--muted)/50 px-2 text-xs"
        />
      </div>
      <Button
        size="sm"
        type="submit"
        disabled={!text.trim()}
        loading={adding}
        className="rounded-xl"
      >
        Add
      </Button>
    </form>
  );
}
