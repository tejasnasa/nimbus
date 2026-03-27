"use client";

import ToggleGroup from "@nimbus/ui/ToggleGroup";
import CreateWorkspaceCard from "./CreateWorkspaceCard";
import { Workspace } from "@nimbus/types";
import WorkspaceCard from "@nimbus/ui/WorkspaceCard";
import { useState } from "react";

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

  console.log("Filtered Workspaces:", filteredWorkspaces);

  return (
    <>
      <ToggleGroup
        options={["All Workspaces", "My Workspaces"]}
        onChange={(selected) => setFilter(selected)}
      />
      <section className="mx-28 flex flex-wrap gap-[1%]">
        <CreateWorkspaceCard />
        {filteredWorkspaces.map((ws) => (
          <WorkspaceCard key={ws.id} workspace={ws} deleteWorkspace={deleteWorkspace} />
        ))}
      </section>
    </>
  );
}
