/**
 * @module api/lib/meeting/resolveOwner
 * @description Matching the owner's name as spoken in a meeting ("Priya will
 * send it") to a workspace member.
 *
 * Matching runs in three passes, stopping at the first that finds anything: the
 * whole name, case-insensitively; then the first name; then a prefix of the
 * name. A pass that finds more than one member is ambiguous, and so is the
 * answer: `null`, never a guess between people.
 *
 * @important Comparison is Unicode-aware: names are normalised (NFKC), have
 *            their whitespace collapsed and are lower-cased with the default
 *            locale-independent rules, so "Zoë" matches "ZOË" and a name
 *            typed with a combining accent matches the precomposed one.
 */

/** A member a spoken name can resolve to. */
export type OwnerCandidate = { userId: string; name: string };

/** The fewest characters a prefix may have to count as a match. */
const MIN_PREFIX_LENGTH = 2;

/** Canonical comparison form of a name. */
function fold(name: string): string {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Resolves a spoken name to one member.
 *
 * @param name - The owner as the model heard it.
 * @param members - The workspace's members.
 * @returns The member's user id, or `null` when nothing or more than one matched.
 */
export function resolveOwner(
  name: string,
  members: readonly OwnerCandidate[],
): string | null {
  const wanted = fold(name);
  if (wanted.length === 0) return null;

  const folded = members.map((member) => ({
    userId: member.userId,
    full: fold(member.name),
  }));

  const passes: Array<(full: string) => boolean> = [
    (full) => full === wanted,
    (full) => full.split(" ")[0] === wanted,
    (full) => wanted.length >= MIN_PREFIX_LENGTH && full.startsWith(wanted),
  ];

  for (const matches of passes) {
    const found = [
      ...new Set(
        folded.filter((entry) => matches(entry.full)).map((e) => e.userId),
      ),
    ];
    if (found.length === 1) return found[0]!;
    if (found.length > 1) return null;
  }
  return null;
}
