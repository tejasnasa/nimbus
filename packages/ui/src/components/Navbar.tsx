/**
 * @module ui/components/Navbar
 * @description Top bar for signed-in pages: the Nimbus logo on the left, then
 * a Docs link (or a custom back link) and an account pill (avatar, name,
 * chevron) that opens an `OptionMenu` (Settings / Contact / Sign Out).
 * Falls back to `getAvatarForUser(id)` when no custom avatar URL is provided.
 *
 * The Settings and Contact items are only wired when their handler is
 * provided; when omitted, they remain in the menu for visual parity but do
 * nothing on click. `OptionMenu` exposes only `onClick`, so navigation lives in
 * the caller — see `apps/web/components/UserNavbar.tsx`.
 */
import Link from "next/link";
import Avatar from "./Avatar";
import Logo from "./Logo";
import OptionMenu from "./OptionsMenu";
import Chat from "./icons/Chat";
import Settings from "./icons/Settings";
import Logout from "./icons/Logout";
import { getAvatarForUser } from "../utils/getAvatarForUser";

/**
 * Top navigation bar.
 *
 * @param props.logout - Sign-out handler wired to the "Sign Out" menu item.
 * @param props.onSettings - Optional handler for the "Settings" menu item.
 * @param props.onContact - Optional handler for the "Contact" menu item.
 * @param props.avatar - Custom avatar URL; deterministic fallback when nullish.
 * @param props.id - User ID used for the fallback avatar hash.
 * @param props.name - Display name shown in the pill and as the menu header.
 * @param props.backLink - Replaces the Docs link with a link back to a parent page.
 */
export default function Navbar({
  logout,
  onSettings,
  onContact,
  avatar,
  id,
  name,
  backLink,
}: {
  logout: () => void;
  onSettings?: () => void;
  onContact?: () => void;
  avatar?: string | null;
  id: string;
  name: string;
  backLink?: { href: string; label: string };
}) {
  const linkClass =
    "text-sm text-(--text-body) transition-colors hover:text-(--foreground) focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-(--violet)";

  return (
    <header className="border-b border-(--line-1)">
      <nav
        aria-label="Main"
        className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4 sm:px-10">
        <Link
          href="/"
          className="w-fit text-(--foreground) focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-(--violet)"
        >
          <Logo size={28} />
        </Link>
        <div className="flex items-center gap-3.5">
          {backLink ? (
            <Link href={backLink.href} className={linkClass}>
              {backLink.label}
            </Link>
          ) : (
            <Link href="/docs" className={linkClass}>
              Docs
            </Link>
          )}
          <OptionMenu
            trigger={
              <div className="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-full border border-(--line-2) bg-(--surface-1) py-1 pr-3 pl-1 transition-colors hover:border-(--line-3)">
                <Avatar
                  user={{
                    name: name,
                    image: avatar || getAvatarForUser(id),
                  }}
                  classname="h-8 w-8"
                />
                <span className="hidden max-w-40 truncate text-sm sm:block">
                  {name}
                </span>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--muted-foreground)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
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
                label: "Contact",
                icon: <Chat />,
                onClick: onContact,
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
    </header>
  );
}
