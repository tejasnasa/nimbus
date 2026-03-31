"use client";

import ToggleGroup from "@nimbus/ui/ToggleGroup";
import CreateWorkspaceCard from "./CreateWorkspaceCard";
import { Workspace } from "@nimbus/types";
import WorkspaceCard from "@nimbus/ui/WorkspaceCard";
import { useState } from "react";
import Masonry from "react-masonry-css";

const breakpointColumnsObj = {
  default: 4,
  1280: 4,
  1024: 3,
  768: 2,
  640: 1,
};

export default function ViewWorkspaces({
  workspaces,
  id,
  deleteWorkspace,
}: {
  workspaces: Workspace[];
  id: string;
  deleteWorkspace: (workspaceId: string) => Promise<void>;
}) {
  const [filter, setFilter] = useState("All Workspaces");

  const filteredWorkspaces = workspaces.filter((ws) => {
    if (filter === "My Workspaces") {
      return ws.members.some((m) => m.id === id && m.role === "OWNER");
    }
    return true;
  });

  return (
    <>
      <ToggleGroup
        options={["All Workspaces", "My Workspaces"]}
        onChange={(selected) => setFilter(selected)}
      />
      <Masonry
        breakpointCols={breakpointColumnsObj}
        className="flex gap-5 mt-6"
        columnClassName="space-y-5"
      >
        <CreateWorkspaceCard />

        {filteredWorkspaces.map((ws, i) => (
          <div
            key={ws.id}
            className="animate-scale-in"
            style={{ animationDelay: `${(i + 1) * 0.05}s` }}
          >
            <WorkspaceCard workspace={ws} deleteWorkspace={deleteWorkspace} />
          </div>
        ))}
      </Masonry>
    </>
  );
}
