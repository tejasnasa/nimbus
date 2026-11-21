/**
 * @module web/components/SiteNavbar
 * @description The public site's top bar, shared by the landing page and the
 * docs: logo, section links, Docs, Contact and the Get Started button.
 *
 * @important Fixed, not sticky, and 4rem tall: every page that renders it pads
 *            its content down by at least that much.
 * @important The section links are `/#…` rather than `#…`, and go through
 *            `next/link`, so from the docs they land on the right section of
 *            the landing page (a full page load to a hash does not, because the
 *            landing page's layout is still settling when the browser jumps);
 *            on the landing page itself they only scroll.
 */
import Cloud from "@nimbus/ui/icons/Cloud";
import Link from "next/link";

const LINKS = [
  { href: "/#features", label: "Features" },
  { href: "/#how-it-works", label: "How It Works" },
  { href: "/#testimonials", label: "Testimonials" },
  { href: "/docs", label: "Docs" },
  { href: "/contact", label: "Contact" },
] as const;

const LINK_CLASS = "hover:text-(--foreground) transition-colors duration-200";

/** Renders the public top bar. */
export default function SiteNavbar() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 backdrop-blur-xl bg-(--background)/70 border-b border-(--border)">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link
          href="/"
          className="flex items-center gap-2.5 font-semibold text-lg group"
        >
          <div className="flex size-9 items-center justify-center rounded-lg text-(--primary-foreground) group-hover:scale-110 transition-transform duration-300">
            <Cloud />
          </div>
          <span className="tracking-tight">Nimbus</span>
        </Link>

        <div className="hidden md:flex items-center gap-8 text-sm text-(--muted-foreground)">
          {LINKS.map(({ href, label }) => (
            <Link key={href} href={href} className={LINK_CLASS}>
              {label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="px-5 py-2.5 text-sm font-medium rounded-xl bg-(--primary) text-(--primary-foreground) hover:opacity-90 active:translate-y-0.5 transition-all duration-200 shadow-lg shadow-(--primary)/20"
          >
            Get Started
          </Link>
        </div>
      </div>
    </nav>
  );
}
