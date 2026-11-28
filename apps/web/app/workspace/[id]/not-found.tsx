/**
 * @module web/app/workspace/[id]/not-found
 * @description Shown when a workspace cannot be loaded. The API answers 404
 * for a missing workspace and for one the viewer is not a member of (so a
 * workspace's existence is never leaked), which is why the copy covers both.
 */
import Link from "next/link";
import {
  AuthHeading,
  StatusShell,
  authPrimaryClass,
} from "../../../components/AuthParts";
import NotFoundPath from "../../../components/NotFoundPath";

export default function NotFound() {
  return (
    <StatusShell maxWidth="max-w-[520px]" centered>
      <div
        className="grid grid-cols-[repeat(3,72px)] gap-2.5"
        aria-hidden="true"
      >
        {[0, 1, 2, 3, 4, 5].map((i) =>
          i === 4 ? (
            <span
              key={i}
              className="flex h-[52px] items-center justify-center rounded-xl border-[1.5px] border-dashed border-[#4a3f55] font-mono text-[15px] font-bold text-(--violet)"
            >
              ?
            </span>
          ) : (
            <span
              key={i}
              className="h-[52px] rounded-xl border border-(--line-1) bg-(--surface-1)"
            />
          ),
        )}
      </div>

      <AuthHeading title="No workspace here">
        It may have been deleted, you may no longer be a member, or the link is
        wrong. If someone sent it to you, ask them for an invite code.
      </AuthHeading>

      <NotFoundPath />

      <Link href="/home" className={`${authPrimaryClass} w-auto px-[22px]`}>
        Back to your workspaces
      </Link>
    </StatusShell>
  );
}
