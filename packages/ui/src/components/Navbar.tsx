/**
 * @module ui/components/Navbar
 * @description Sticky top navigation: Nimbus brand link on the left and an
 * avatar-triggered `OptionMenu` (Settings / Sign Out) on the right. Falls
 * back to `getAvatarForUser(id)` when no custom avatar URL is provided.
 *
 * The Settings menu item is only wired when `onSettings` is provided; when
 * omitted, it remains in the menu for visual parity but does nothing on
 * click. `OptionMenu` exposes only `onClick`, so navigation lives in the
 * caller — see `apps/web/components/UserNavbar.tsx`.
 */
import Link from "next/link";
import Cloud from "./icons/Cloud";
import Avatar from "./Avatar";
import OptionMenu from "./OptionsMenu";
import Settings from "./icons/Settings";
import Logout from "./icons/Logout";
import { getAvatarForUser } from "../utils/getAvatarForUser";

/**
 * Top navigation bar.
 *
 * @param props.logout - Sign-out handler wired to the "Sign Out" menu item.
 * @param props.onSettings - Optional handler for the "Settings" menu item.
 * @param props.avatar - Custom avatar URL; deterministic fallback when nullish.
 * @param props.id - User ID used for the fallback avatar hash.
 * @param props.name - Display name shown as the disabled menu header.
 */
export default function Navbar({
  logout,
  onSettings,
  avatar,
  id,
  name,
}: {
  logout: () => void;
  onSettings?: () => void;
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
            {
              label: "Settings",
              icon: <Settings />,
              onClick: onSettings,
            },
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
