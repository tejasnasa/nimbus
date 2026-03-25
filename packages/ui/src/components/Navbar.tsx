import Link from "next/link";
import Cloud from "./icons/Cloud";
import Avatar from "./Avatar";
import OptionMenu from "./OptionsMenu";
import Settings from "./icons/Settings";
import Logout from "./icons/Logout";
import pic1 from "../assets/avatars/picture1.png";
import pic2 from "../assets/avatars/picture2.png";
import pic3 from "../assets/avatars/picture3.png";
import pic4 from "../assets/avatars/picture4.png";
import pic5 from "../assets/avatars/picture5.png";
import { getAvatarForUser } from "@nimbus/utils";

const avatars = [pic1.src, pic2.src, pic3.src, pic4.src, pic5.src];

export default function Navbar({
  logout,
  avatar,
  id,
  name,
}: {
  logout: () => void;
  avatar?: string | null;
  id: string;
  name: string;
}) {
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
              name: name,
              image: avatar || getAvatarForUser(id, avatars),
            }}
            classname="h-12 w-12"
          />
        }
        items={[
          { label: name, disabled: true },
          { label: "Settings", icon: <Settings /> },
          {
            label: "Sign Out",
            icon: <Logout />,
            destructive: true,
            onClick: logout,
          },
        ]}
        size="lg"
        direction="left"
        className="w-36"
      />
    </section>
  );
}
