/**
 * @module web/components/PresenceAvatars
 * @description The "who's here" strip in the editor header: small avatars of the
 * other people in the open document, ringed in the colour of their cursor, with
 * names on hover and as one accessible label.
 *
 * @important The strip only ever receives *other* people. Excluding the signed-in
 *            user (and their other tabs) happens where the list is built, in
 *            `lib/presence.ts`, so a caller cannot forget to.
 */
import Avatar from "@nimbus/ui/Avatar";
import { getAvatarForUser } from "@nimbus/ui/utils/getAvatarForUser";
import { alsoEditingLabel, type PresencePeer } from "../lib/presence";

/** Avatars shown before the rest collapse into `+N`. */
const MAX_VISIBLE = 4;

/**
 * @param props.peers - Everyone else in the document (any number).
 */
export default function PresenceAvatars({ peers }: { peers: PresencePeer[] }) {
  if (peers.length === 0) return null;

  const visible = peers.slice(0, MAX_VISIBLE);
  const hidden = peers.slice(MAX_VISIBLE);

  return (
    <div
      role="group"
      aria-label={alsoEditingLabel(peers)}
      data-testid="presence-avatars"
      className="flex items-center -space-x-2"
    >
      {visible.map((peer) => (
        <div
          key={peer.userId}
          title={peer.name}
          data-testid="presence-avatar"
          className="rounded-full"
          style={{ boxShadow: `0 0 0 2px ${peer.color}` }}
        >
          <Avatar
            user={{
              name: peer.name,
              image: peer.image ?? getAvatarForUser(peer.userId),
            }}
            classname="h-6 w-6"
          />
        </div>
      ))}

      {hidden.length > 0 && (
        <div
          title={hidden.map((peer) => peer.name).join(", ")}
          data-testid="presence-overflow"
          className="z-10 flex h-6 w-6 items-center justify-center rounded-full border-2 border-(--background) bg-(--muted) text-[10px] font-medium text-(--muted-foreground)"
        >
          +{hidden.length}
        </div>
      )}
    </div>
  );
}
