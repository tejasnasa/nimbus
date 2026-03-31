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
import { getAvatarForUser } from "../utils/getAvatarForUser";

export default function WorkspaceCard({
  workspace,
  deleteWorkspace,
}: {
  workspace: Workspace;
  deleteWorkspace: (workspaceId: string) => Promise<void>;
}) {
  return (
    <Link
      id={workspace.slugId.toString()}
      href={`/workspace/${workspace.slugId}`}
      className="group p-6 rounded-2xl border border-(--border) bg-(--card)/40 backdrop-blur-sm flex flex-col justify-between hover:border-(--primary)/50 hover:bg-(--card)/70 hover:-translate-y-1 hover:shadow-xl hover:shadow-(--primary)/5 transition-all duration-300"
    >
      <div>
        <div className="flex justify-between items-start mb-2">
          <h2 className="text-2xl font-semibold tracking-tight group-hover:text-(--primary) transition-colors duration-300">
            {workspace.name}
          </h2>
          <div
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <OptionMenu
              trigger={
                <button className="p-1.5 hover:cursor-pointer text-(--muted-foreground) rounded-lg hover:bg-(--muted) transition-colors opacity-0 group-hover:opacity-100">
                  <Options />
                </button>
              }
              size="sm"
              direction="right"
              className="w-44"
              items={[
                {
                  label: "Copy Invite Code",
                  icon: <Clipboard />,
                  onClick: () =>
                    navigator.clipboard.writeText(workspace.inviteCode),
                },
                { label: "Duplicate", icon: <Duplicate />, disabled: true },
                {
                  label: "Delete",
                  destructive: true,
                  icon: <Delete />,
                  onClick: () => deleteWorkspace(workspace.id),
                },
              ]}
            />
          </div>
        </div>

        <div className="text-xs text-(--muted-foreground) flex items-center mb-5 gap-1.5">
          <Clock />
          <span>{timeAgo(workspace.updatedAt)}</span>
        </div>
        <AvatarGroup
          users={
            workspace.members?.map((member) => ({
              image: member.image || getAvatarForUser(member.id),
              online: member.online,
            })) || []
          }
        />
      </div>

      <p className="text-sm text-(--muted-foreground) mt-5 leading-relaxed line-clamp-2">
        {workspace.description}
      </p>
    </Link>
  );
}
