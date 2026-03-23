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
    <img
      src={user.image}
      alt={user.name}
      className={`rounded-full border-2 border-(--background) object-cover transition-colors hover:cursor-pointer ${user.isOnline ? "ring-1 ring-(--chart-2)" : ""} ${classname || ""} `}
    />
  );
}
