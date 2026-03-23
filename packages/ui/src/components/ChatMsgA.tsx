import Avatar from "./Avatar";

export default function ChatMsgA({
  name,
  image,
  message,
}: {
  name: string;
  image: string;
  message: string;
}) {
  return (
    <div className="flex items-center m-2">
      <Avatar
        user={{
          name: name,
          image: image,
        }}
        classname="w-8 h-8 m-2"
      />
      <div className="text-sm bg-(--card) p-1.5 w-fit rounded-md">
        {message}
      </div>
    </div>
  );
}
