/**
 * @module ui/components/AvatarGroup
 * @description Overlapping avatar stack with overflow counter (e.g. `+4`).
 * Used on workspace cards and member lists.
 */
type AvatarGroupProps = {
  /** Member images with optional per-user online flag. */
  users: { image: string; online?: boolean }[];
  /** Max avatars shown before collapsing into the `+N` counter. Defaults to 3. */
  max?: number;
  className?: string;
};

/**
 * Overlapping avatar stack.
 *
 * Later avatars render underneath earlier ones via descending `zIndex`,
 * and any members beyond `max` collapse into a `+N` badge.
 */
export default function AvatarGroup({
  users,
  max = 3,
  className,
}: AvatarGroupProps) {
  const visible = users.slice(0, max);
  const remaining = users.length - max;

  return (
    <div className={`flex items-center ${className || ""}`}>
      {visible.map((user, i) => (
        <div
          key={i}
          className="relative -ml-3 first:ml-0"
          style={{ zIndex: visible.length - i }}
        >
          <img
            src={user.image}
            className="h-9 w-9 rounded-full border-2 border-(--background) object-cover"
          />
          {user.online && (
            <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-(--chart-2) border-2 border-(--background)" />
          )}
        </div>
      ))}

      {remaining > 0 && (
        <div className="h-9 w-9 rounded-full flex items-center justify-center text-xs font-medium bg-(--muted) text-(--muted-foreground) border-2 border-(--background) -ml-3">
          +{remaining}
        </div>
      )}
    </div>
  );
}
