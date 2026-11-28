"use client";

import CreateWorkspaceCard from "./CreateWorkspaceCard";
import { Workspace } from "@nimbus/types";
import WorkspaceCard from "@nimbus/ui/WorkspaceCard";
import { useState } from "react";

/**
 * @module web/components/ViewWorkspaces
 * @description Dashboard body: the greeting and "Your workspaces" heading, the
 * All/My filter (My = OWNER role), the join and create actions, and a
 * responsive grid of `WorkspaceCard`s with staggered `animate-slide-up`
 * entrances. When the filter leaves nothing to show, a dashed empty state
 * takes the grid's place.
 */

const FILTERS = ["All workspaces", "My workspaces"] as const;

/**
 * @param props.workspaces - All member workspaces.
 * @param props.id - Current user (OWNER check for the My filter).
 * @param props.deleteWorkspace - Delete handler for cards.
 * @param props.firstName - Given name for the greeting; omitted when unknown.
 */
export default function ViewWorkspaces({
  workspaces,
  id,
  deleteWorkspace,
  firstName,
}: {
  workspaces: Workspace[];
  id: string;
  deleteWorkspace: (workspaceId: string) => Promise<void>;
  firstName?: string;
}) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>(FILTERS[0]);

  const filteredWorkspaces = workspaces.filter((ws) => {
    if (filter === "My workspaces") {
      return ws.members.some((m) => m.id === id && m.role === "OWNER");
    }
    return true;
  });

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div className="flex flex-col gap-2.5">
          <span className="font-mono text-xs tracking-[0.12em] text-(--violet) uppercase">
            {firstName ? `Welcome back, ${firstName}` : "Welcome back"}
          </span>
          <h1 className="font-display text-[44px] leading-[1.02] font-semibold tracking-[-0.035em] sm:text-[66px]">
            Your workspaces
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <div
            role="group"
            aria-label="Filter workspaces"
            className="flex rounded-xl border border-(--line-2) bg-(--surface-1) p-1"
          >
            {FILTERS.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={filter === option}
                onClick={() => setFilter(option)}
                className={`min-h-9 cursor-pointer rounded-[9px] px-3.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-(--violet) ${
                  filter === option
                    ? "bg-(--surface-4) text-(--foreground)"
                    : "text-(--muted-foreground) hover:text-(--foreground)"
                }`}
              >
                {option}
              </button>
            ))}
          </div>
          <CreateWorkspaceCard />
        </div>
      </div>

      {filteredWorkspaces.length > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,340px),1fr))] gap-4.5">
          {filteredWorkspaces.map((ws, i) => (
            <div
              key={ws.id}
              className="animate-slide-up flex flex-col *:flex-1"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <WorkspaceCard
                workspace={ws}
                deleteWorkspace={deleteWorkspace}
                currentUserId={id}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-[18px] border border-dashed border-(--line-3) p-12 text-center text-[15px] text-(--muted-foreground)">
          {filter === "My workspaces"
            ? "You don't own a workspace yet. Create one to get started."
            : "You aren't in a workspace yet. Create one or join with an invite code."}
        </div>
      )}
    </>
  );
}
