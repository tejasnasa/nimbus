import Link from "next/link";
import Cloud from "./icons/Cloud";
import Avatar from "./Avatar";
import OptionMenu from "./OptionsMenu";
import Settings from "./icons/Settings";
import Logout from "./icons/Logout";
import { getAvatarForUser } from "../utils/getAvatarForUser";

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
    <nav className="sticky top-0 z-40 backdrop-blur-xl bg-(--background)/70 border-b border-(--border)">
      <div className="max-w-350 mx-auto px-8 h-16 flex items-center justify-between">
        <Link
          href="/"
          className="flex items-center gap-2.5 font-semibold text-lg group"
        >
          <div className="flex size-9 items-center justify-center rounded-lg text-(--primary-foreground) group-hover:scale-110 transition-transform duration-300">
            <Cloud />
          </div>
          <span className="tracking-tight">Nimbus</span>
        </Link>
        <OptionMenu
          trigger={
            <div className="ring-2 ring-transparent hover:ring-(--primary)/50 rounded-full transition-all duration-300">
              <Avatar
                user={{
                  name: name,
                  image: avatar || getAvatarForUser(id),
                }}
                classname="h-10 w-10"
              />
            </div>
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
          className="w-44"
        />
      </div>
    </nav>
  );
}
