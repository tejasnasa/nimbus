import Link from "next/link";
import Cloud from "./icons/Cloud";
import Avatar from "./Avatar";
import OptionMenu from "./OptionsMenu";
import Settings from "./icons/Settings";
import Logout from "./icons/Logout";
import { getAvatarForUser } from "@nimbus/utils";

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
              image: avatar || getAvatarForUser(id),
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
