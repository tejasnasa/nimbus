import Link from "next/link";
import OptionMenu from "./OptionsMenu";
import Options from "./icons/Options";
import Delete from "./icons/Delete";
import Clipboard from "./icons/Clipboard";
import Duplicate from "./icons/Duplicate";
import { timeAgo } from "@nimbus/utils";
import { Workspace } from "@nimbus/types";
/**
 * @module ui/components/WorkspaceCard
 * @description Clickable workspace summary card linking to
 * `/workspace/[slugId]`: initial badge tinted by a hue derived from the
 * workspace id, the viewer's role, name, description, and a footer with a
 * member avatar stack, member count and relative update time, plus a
 * menu (copy invite code / delete).
 * The menu click is stop-propagated so it never triggers navigation.
 */
import { getAvatarForUser } from "../utils/getAvatarForUser";

/** Badge accents, picked deterministically from the workspace id. */
const HUES = [
  "var(--violet)",
  "var(--lime)",
  "var(--sky)",
  "var(--amber)",
  "var(--pink)",
];

/** Role chip colours: owner reads as lime, admin as violet, member as neutral. */
const ROLE_STYLES: Record<string, string> = {
  OWNER: "bg-(--lime)/15 text-(--lime)",
  ADMIN: "bg-(--violet)/15 text-(--violet-pale)",
  MEMBER: "bg-(--surface-4) text-(--text-body)",
};

const MAX_AVATARS = 3;

/** Stable index into {@link HUES} for a workspace id. */
function hueFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++)
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return HUES[hash % HUES.length]!;
}

/**
 * Workspace summary card.
 *
 * @param props.workspace - Workspace DTO with members and invite code.
 * @param props.deleteWorkspace - Delete handler invoked from the card menu.
 * @param props.currentUserId - Viewer id; when it matches a member, that
 *   member's role is shown as a chip.
 */
export default function WorkspaceCard({
  workspace,
  deleteWorkspace,
  currentUserId,
}: {
  workspace: Workspace;
  deleteWorkspace: (workspaceId: string) => Promise<void>;
  currentUserId?: string;
}) {
  const members = workspace.members ?? [];
  const hue = hueFor(workspace.id);
  const role = currentUserId
    ? members.find((m) => m.id === currentUserId)?.role
    : undefined;
  const shown = members.slice(0, MAX_AVATARS);
  const extra = members.length - shown.length;

  return (
    <Link
      id={workspace.slugId.toString()}
      href={`/workspace/${workspace.slugId}`}
      className="group flex flex-col gap-4.5 rounded-[18px] border border-(--line-2) bg-(--surface-1) p-5.5 text-(--foreground) transition-[transform,border-color,background-color] duration-200 hover:-translate-y-1 hover:border-(--violet)/40 hover:bg-(--surface-2) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--violet) motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      <div className="flex items-start justify-between gap-3">
        <span
          aria-hidden="true"
          className="flex size-11.5 items-center justify-center rounded-[14px] bg-(--surface-3) font-display text-xl font-bold"
          style={{
            color: hue,
            boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${hue} 33%, transparent)`,
          }}
        >
          {workspace.name.charAt(0).toUpperCase()}
        </span>
        <div className="flex items-center gap-1.5">
          {role && (
            <span
              className={`rounded-[7px] px-2.25 py-1 font-mono text-[11px] ${ROLE_STYLES[role] ?? ROLE_STYLES.MEMBER}`}
            >
              {role.charAt(0) + role.slice(1).toLowerCase()}
            </span>
          )}
          <div
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <OptionMenu
              trigger={
                <button
                  aria-label="Workspace options"
                  className="rounded-lg p-1.5 text-(--muted-foreground) transition-colors hover:cursor-pointer hover:bg-(--muted) hover:text-(--foreground)"
                >
                  <Options />
                </button>
              }
              size="sm"
              direction="left"
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
      </div>

      <div className="flex flex-col gap-1.5">
        <h2 className="font-display text-[21px] font-semibold tracking-[-0.01em]">
          {workspace.name}
        </h2>
        <p className="min-h-10.5 text-sm leading-normal text-(--muted-foreground) line-clamp-2">
          {workspace.description}
        </p>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-(--line-1) pt-3.5">
        <div className="flex items-center gap-2.5">
          <div className="flex">
            {shown.map((member, i) => (
              <img
                key={member.id}
                src={member.image || getAvatarForUser(member.id)}
                alt=""
                className={`size-6.5 rounded-full object-cover ring-2 ring-(--surface-1) ${i ? "-ml-1.5" : ""}`}
              />
            ))}
            {extra > 0 && (
              <span className="-ml-1.5 flex size-6.5 items-center justify-center rounded-full bg-(--surface-4) text-[11px] font-bold text-(--text-body) ring-2 ring-(--surface-1)">
                +{extra}
              </span>
            )}
          </div>
          <span className="text-[13px] text-(--muted-foreground)">
            {members.length} {members.length === 1 ? "member" : "members"}
            <span aria-hidden="true"> · </span>
            {timeAgo(workspace.updatedAt)}
          </span>
        </div>
        <span className="inline-flex -translate-x-1.5 items-center gap-1.5 text-[13px] text-(--violet-soft) opacity-0 transition-[opacity,transform] duration-200 group-hover:translate-x-0 group-hover:opacity-100 motion-reduce:transition-none">
          Open
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </span>
      </div>
    </Link>
  );
}
