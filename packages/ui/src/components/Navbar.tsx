import Link from "next/link";
import Cloud from "./icons/Cloud";
import Avatar from "./Avatar";
import OptionMenu from "./OptionsMenu";
import Settings from "./icons/Settings";
import Logout from "./icons/Logout";

export default function Navbar() {
  return (
    <section className="m-4 mx-16 flex justify-between">
      <Link href="/" className="flex items-center gap-2 font-medium">
        <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Cloud />
        </div>
        Nimbus
      </Link>
      <OptionMenu
        trigger={
          <Avatar
            user={{
              name: "Tejas Nasa",
              image:
                "https://static.vecteezy.com/system/resources/thumbnails/009/292/244/small/default-avatar-icon-of-social-media-user-vector.jpg",
            }}
          />
        }
        items={[
          { label: "Settings", icon: <Settings /> },
          { label: "Sign Out", icon: <Logout />, destructive: true },
        ]}
        size="lg"
        direction="left"
        className="w-36"
      />
    </section>
  );
}
