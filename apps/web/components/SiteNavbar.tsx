/**
 * @module web/components/SiteNavbar
 * @description The public site's top bar, shared by the landing page, the
 * contact page and the docs: logo, section links, Docs, Contact and the Sign in
 * button. Below `md` the links collapse into a menu button.
 *
 * Two variants with the same contents: `page` (the default) sits in the normal
 * flow at the top of a marketing page; `docs` is sticky and blurred, so the
 * reading column keeps its navigation in view.
 *
 * @important The section links are `/#…` rather than `#…`, and go through
 *            `next/link`, so from the docs or contact page they land on the
 *            right section of the landing page (a full page load to a hash does
 *            not, because the landing page's layout is still settling when the
 *            browser jumps); on the landing page itself they only scroll.
 * @important The `docs` variant is sticky and 5.25rem tall; the docs layout
 *            offsets its own sticky columns by that.
 */
"use client";
import Logo from "@nimbus/ui/Logo";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const LINKS = [
  { href: "/#demo", label: "Demo" },
  { href: "/docs", label: "Docs" },
  { href: "/contact", label: "Contact" },
] as const;

const LINK_CLASS =
  "text-(--text-body) transition-colors hover:text-(--foreground) focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-(--violet)";

const SIGN_IN_CLASS =
  "inline-flex min-h-10 items-center rounded-[10px] bg-(--foreground) px-4 font-semibold text-(--ink) transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--violet)";

/**
 * Renders the public top bar.
 *
 * @param props.variant - `page` for the in-flow bar, `docs` for the sticky
 *                        documentation header.
 */
export default function SiteNavbar({
  variant = "page",
}: {
  variant?: "page" | "docs";
}) {
  const pathname = usePathname() ?? "";
  const [openAt, setOpenAt] = useState<string | null>(null);
  // Keyed on the pathname so the menu closes itself after every navigation.
  const open = openAt === pathname;

  const docs = variant === "docs";
  const links = LINKS;
  const isCurrent = (href: string) =>
    href !== "/" && !href.startsWith("/#") && pathname.startsWith(href);

  const renderLink = (href: string, label: string) => {
    const external = href.startsWith("http");
    const props = {
      className: `${LINK_CLASS} ${isCurrent(href) ? "text-(--foreground)!" : ""}`,
      "aria-current": isCurrent(href) ? ("page" as const) : undefined,
    };
    return external ? (
      <a
        key={href}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        {...props}
      >
        {label}
      </a>
    ) : (
      <Link key={href} href={href} {...props}>
        {label}
      </Link>
    );
  };

  return (
    <header
      className={`font-sans ${
        docs
          ? "sticky top-0 z-20 border-b border-(--line-1) bg-(--background)/90 backdrop-blur-md"
          : "relative z-20"
      }`}
    >
      <nav
        aria-label="Site"
        className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-5 py-5.5 sm:px-10"
      >
        <div className="flex items-center gap-4.5">
          <Link
            href="/"
            aria-label="Nimbus home"
            className="text-(--foreground) focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-(--violet)"
          >
            <Logo size={30} />
          </Link>
        </div>

        <div className="hidden items-center gap-7 text-sm md:flex">
          {links.map(({ href, label }) => renderLink(href, label))}
          <Link href="/login" className={SIGN_IN_CLASS}>
            Sign in
          </Link>
        </div>

        <button
          type="button"
          className="inline-flex size-10 cursor-pointer items-center justify-center rounded-[10px] border border-(--line-3) text-(--foreground) md:hidden"
          aria-expanded={open}
          aria-controls="site-menu"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpenAt(open ? null : pathname)}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
      </nav>

      {open && (
        <div
          id="site-menu"
          className="mx-5 mb-4 flex flex-col gap-1 rounded-2xl border border-(--line-2) bg-(--surface-1) p-3 text-[15px] md:hidden sm:mx-10"
        >
          {links.map(({ href, label }) => {
            const external = href.startsWith("http");
            const cls =
              "rounded-lg px-3 py-2.5 text-(--text-soft) hover:bg-(--surface-3)";
            return external ? (
              <a
                key={href}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className={cls}
              >
                {label}
              </a>
            ) : (
              <Link key={href} href={href} className={cls}>
                {label}
              </Link>
            );
          })}
          <Link href="/login" className={`${SIGN_IN_CLASS} mt-1 justify-center`}>
            Sign in
          </Link>
        </div>
      )}
    </header>
  );
}
