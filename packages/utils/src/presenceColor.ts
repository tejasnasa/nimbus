/**
 * @module utils/presenceColor
 * @description Deterministic collaborator colour. The API stamps it onto
 * canvas pointers and markdown awareness, and the web uses it for the local
 * user's own state, so every participant sees one person in one colour without
 * any coordination.
 *
 * @important Colours are six-digit `#rrggbb` on purpose: y-prosemirror's cursor
 *            plugin only supports that format (it appends an alpha byte to
 *            build the selection tint). Every entry is light enough to read
 *            against the dark theme.
 */

/** Distinct, dark-theme-safe colours; the order is part of the contract. */
export const PRESENCE_PALETTE = [
  "#f87171",
  "#fb923c",
  "#fbbf24",
  "#a3e635",
  "#34d399",
  "#22d3ee",
  "#60a5fa",
  "#a78bfa",
  "#f472b6",
  "#e879f9",
] as const;

/**
 * Picks a stable colour for a user.
 *
 * @param userId - User id; the same id always yields the same colour.
 * @returns A `#rrggbb` entry of {@link PRESENCE_PALETTE}.
 */
export function presenceColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return PRESENCE_PALETTE[hash % PRESENCE_PALETTE.length]!;
}
