"use client";

import Link from "next/link";
import AvatarGroup from "./AvatarGroup";
import { timeAgo } from "@nimbus/utils";
import Clock from "./icons/Clock";
import OptionMenu from "./OptionsMenu";
import Options from "./icons/Options";
import Delete from "./icons/Delete";
import Clipboard from "./icons/Clipboard";
import Duplicate from "./icons/Duplicate";
import { Workspace } from "@nimbus/types";

export default function WorkspaceCard({workspace}: { workspace: Workspace }) {
  return (
    <Link
      id={workspace.slugId.toString()}
      href={`/workspace/${workspace.slugId}/${workspace.slug}`}
      className="w-[24%] p-6 bg-(--card) rounded-lg flex flex-col justify-between hover:shadow-lg hover:border-(--primary) hover:-translate-y-0.5 transition-all duration-200"
    >
      <div>
        <div className="flex justify-between items-center mb-2">
          <h2 className="text-3xl">{workspace.name}</h2>
          <div
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <OptionMenu
              trigger={
                <button className="p-1.5 hover:cursor-pointer text-(--muted-foreground) rounded-md hover:bg-(--muted) transition-colors">
                  <Options />
                </button>
              }
              size="sm"
              direction="right"
              className="w-44"
              items={[
                { label: "Copy Invite Code", icon: <Clipboard /> },
                { label: "Duplicate", icon: <Duplicate />, disabled: true },
                {
                  label: "Delete",
                  destructive: true,
                  icon: <Delete />,
                },
              ]}
            />
          </div>
        </div>

        <div className="text-sm text-(--muted-foreground) flex items-center mb-6">
          <Clock />
          <span className="ml-2">{timeAgo(workspace.updatedAt)}</span>
        </div>
        {/* <AvatarGroup
          users={
            workspace.members?.map((member) => ({
              image: member.image,
              online: member.online,
            })) || []
          }
        /> */}
      </div>

      <div>
        <p className="text-sm text-(--muted-foreground) mt-4">
          {workspace.description}
        </p>
      </div>
    </Link>
  );
}
