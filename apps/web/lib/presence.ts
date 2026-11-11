/**
 * @module web/lib/presence
 * @description Pure helpers for showing who else is in a document: the local
 * user's awareness identity, the de-duplicated list of other people derived from
 * awareness states or a canvas roster, and the throttle that keeps pointer
 * traffic to about twenty events a second.
 *
 * @important "Others" means other *people*, not other sessions. The same user
 *            in a second tab or window is dropped by `userId`, so you never see
 *            yourself in the "Also editing" list.
 */
import type { PresenceUser } from "@nimbus/types";
import { presenceColor } from "@nimbus/utils";

/** The signed-in user, as far as presence needs to know. */
export type LocalPresenceUser = {
  id: string;
  name: string;
  image?: string | null;
};

/** Another person on the document, as drawn in the header. */
export type PresencePeer = {
  userId: string;
  name: string;
  color: string;
  image: string | null;
};

/**
 * The `user` field the local awareness publishes. The server overwrites it with
 * the authenticated identity, so this only has to be right for the local view
 * and for the moments before the first round-trip.
 *
 * @param user - The signed-in user.
 */
export function localAwarenessUser(user: LocalPresenceUser): PresenceUser {
  return {
    userId: user.id,
    name: user.name,
    color: presenceColor(user.id),
    image: user.image ?? null,
  };
}

const asPeer = (value: unknown): PresencePeer | null => {
  if (typeof value !== "object" || value === null) return null;
  const { userId, name, color, image } = value as Record<string, unknown>;
  if (typeof userId !== "string" || typeof name !== "string") return null;
  return {
    userId,
    name,
    color: typeof color === "string" ? color : presenceColor(userId),
    image:
      typeof image === "string" && image.startsWith("https://") ? image : null,
  };
};

function uniquePeers(
  candidates: (PresencePeer | null)[],
  selfUserId?: string,
): PresencePeer[] {
  const byUser = new Map<string, PresencePeer>();
  for (const peer of candidates) {
    if (!peer || peer.userId === selfUserId || byUser.has(peer.userId)) {
      continue;
    }
    byUser.set(peer.userId, peer);
  }
  return [...byUser.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId),
  );
}

/**
 * Lists the other people in an awareness, one entry per user.
 *
 * @param states - `awareness.getStates()`.
 * @param selfClientId - This tab's awareness client id.
 * @param selfUserId - The signed-in user's id, so their other tabs are dropped.
 * @returns Peers ordered by name, so the header does not reshuffle as cursors move.
 */
export function peersFromAwareness(
  states: ReadonlyMap<number, Record<string, unknown>>,
  selfClientId: number,
  selfUserId?: string,
): PresencePeer[] {
  return uniquePeers(
    [...states]
      .filter(([clientId]) => clientId !== selfClientId)
      .map(([, state]) => asPeer(state.user)),
    selfUserId,
  );
}

/**
 * Lists the other people in a roster of presence users.
 *
 * @param roster - Users currently known on the document.
 * @param selfUserId - The signed-in user's id.
 */
export function peersFromRoster(
  roster: Iterable<PresenceUser>,
  selfUserId?: string,
): PresencePeer[] {
  return uniquePeers([...roster].map(asPeer), selfUserId);
}

/** Whether two peer lists would render identically (state-update guard). */
export function samePeers(a: PresencePeer[], b: PresencePeer[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (peer, i) =>
        peer.userId === b[i]!.userId &&
        peer.name === b[i]!.name &&
        peer.color === b[i]!.color &&
        peer.image === b[i]!.image,
    )
  );
}

/**
 * Accessible label for the "who's here" strip, e.g. `Also editing: Ada, Grace`.
 *
 * @param peers - The people to name; all of them, including any hidden as `+N`.
 */
export function alsoEditingLabel(peers: PresencePeer[]): string {
  return `Also editing: ${peers.map((p) => p.name).join(", ")}`;
}

/** Throttle with a trailing call, so the last position is never lost. */
export type Throttled<A extends unknown[]> = {
  (...args: A): void;
  /** Cancels a pending trailing call. */
  cancel: () => void;
};

/**
 * Limits a function to one call per interval, delivering the latest arguments
 * once the interval has passed.
 *
 * @param fn - Function to throttle.
 * @param intervalMs - Minimum gap between calls (50 ms is 20 calls a second).
 * @param now - Clock; injectable for tests.
 */
export function throttle<A extends unknown[]>(
  fn: (...args: A) => void,
  intervalMs: number,
  now: () => number = Date.now,
): Throttled<A> {
  let last = -Infinity;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: A | null = null;

  const run = (args: A) => {
    last = now();
    fn(...args);
  };

  const throttled = ((...args: A) => {
    const wait = last + intervalMs - now();
    if (wait <= 0 && !timer) return run(args);

    pending = args;
    if (timer) return;
    timer = setTimeout(
      () => {
        timer = null;
        const next = pending;
        pending = null;
        if (next) run(next);
      },
      Math.max(wait, 0),
    );
  }) as Throttled<A>;

  throttled.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    pending = null;
  };

  return throttled;
}
