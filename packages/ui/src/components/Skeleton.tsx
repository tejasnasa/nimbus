/**
 * @module ui/components/Skeleton
 * @description Shimmer loading placeholder. Size/shape come entirely from the
 * caller's `className` (e.g. `h-4 w-32`); the shimmer sweep is baked in.
 */
export function Skeleton({
  className = "",
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`bg-linear-to-r from-(--muted)/40 via-(--muted)/70 to-(--muted)/40 animate-shimmer rounded-xl ${className}`}
      style={{ backgroundSize: "200% 100%", ...style }}
    />
  );
}
