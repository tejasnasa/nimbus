/**
 * @module ui/components/Avatar
 * @description Circular user avatar with an optional online presence dot.
 * Sizing is controlled by the parent via `classname` (e.g. `h-10 w-10`).
 */
interface AvatarProps {
  /** User display data; `isOnline` toggles the green presence dot. */
  user: {
    name: string;
    image: string;
    isOnline?: boolean;
  };
  /** Size/position classes applied to the wrapper (note: `classname`, not `className`). */
  classname?: string;
}

/**
 * Circular avatar image with optional online indicator.
 *
 * @param props.user - User display data (name for alt text, image src).
 * @param props.classname - Wrapper sizing classes.
 */
export default function Avatar({ user, classname }: AvatarProps) {
  return (
    <div className={`relative ${classname || ""}`}>
      <img
        src={user.image}
        alt={user.name}
        className={`w-full h-full rounded-full border-2 border-(--background) object-cover transition-all duration-200 hover:cursor-pointer hover:opacity-90`}
      />
      {user.isOnline && (
        <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-(--chart-2) border-2 border-(--background)" />
      )}
    </div>
  );
}
