import Avatar from "./Avatar";

export default function ChatMsgB({
  name,
  image,
  message,
}: {
  name: string;
  image: string;
  message: string;
}) {
  return (
    <div className="flex items-center justify-end m-2">
      <div className="text-sm bg-(--card) p-1.5 w-fit rounded-md">
        {message}
      </div>
      <Avatar
        user={{
          name: name,
          image: image,
        }}
        classname="w-8 h-8 ml-2"
      />
    </div>
  );
}
