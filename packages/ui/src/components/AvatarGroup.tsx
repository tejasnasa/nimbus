type AvatarGroupProps = {
  users: { image: string; online?: boolean }[];
  max?: number;
  className?: string;
};

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
        <div key={i} className="relative -ml-2.5 first:ml-0">
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
        <div className="h-9 w-9 rounded-full flex items-center justify-center text-xs font-medium bg-(--muted) text-(--muted-foreground) border-2 border-(--background) -ml-2.5">
          +{remaining}
        </div>
      )}
    </div>
  );
}
