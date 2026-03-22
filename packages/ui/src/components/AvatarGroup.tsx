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
    <div className={`flex items-center ${className}`}>
      {visible.map((user, i) => (
        <img
          key={i}
          src={user.image}
          className={`h-12 w-12 rounded-full border-2 border-(--background) -ml-3.5 first:ml-0 object-cover ${user.online ? "ring-2 ring-green-500" : ""}`}
        />
      ))}

      {remaining > 0 && (
        <div className="h-12 w-12 rounded-full flex items-center justify-center text-s bg-(--muted) text-(--muted-foreground) border-2 border---background) -ml-3.5">
          +{remaining}
        </div>
      )}
    </div>
  );
}
