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
  StatusTiles,
  authPrimaryClass,
} from "../../../components/AuthParts";
import NotFoundPath from "../../../components/NotFoundPath";

export default function NotFound() {
  return (
    <StatusShell maxWidth="max-w-[520px]" centered>
      <StatusTiles mark="?" />

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
