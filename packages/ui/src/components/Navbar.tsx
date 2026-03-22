import Link from "next/link";
import Cloud from "./icons/Cloud";
import Avatar from "./Avatar";

export default function Navbar() {
  return (
    <section className="m-4 mx-16 flex justify-between">
      <Link href="/" className="flex items-center gap-2 font-medium">
        <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Cloud />
        </div>
        Nimbus
      </Link>
      <Avatar
        user={{
          name: "Tejas Nasa",
          image:
            "https://static.vecteezy.com/system/resources/thumbnails/009/292/244/small/default-avatar-icon-of-social-media-user-vector.jpg",
        }}
      />
    </section>
  );
}
