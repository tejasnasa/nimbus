interface AvatarProps {
  user: {
    name: string;
    image: string;
  };
}

export default function Avatar({ user }: AvatarProps) {
  return (
    <img
      src={user.image}
      alt={user.name}
      className="h-12 w-12 rounded-full border-2 border-(--background) -ml-3.5 first:ml-0 object-cover hover:border-(--primary) transition-colors hover:cursor-pointer"
    />
  );
}
