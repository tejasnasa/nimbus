interface AvatarProps {
  user: {
    name: string;
    image: string;
    isOnline?: boolean;
  };
  classname?: string;
}

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
