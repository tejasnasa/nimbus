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
