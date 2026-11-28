/**
 * @module web/components/landing/SiteFooter
 * @description The public site footer: logo and tagline, product and resource
 * link columns, contact links and the licence line. Anchors into the landing
 * page use `/#…` so they work from other pages too.
 */
import Logo from "@nimbus/ui/Logo";
import Link from "next/link";
import type { ReactNode } from "react";

const LINK =
  "inline-flex items-center gap-2 text-(--text-soft) transition-colors hover:text-(--foreground) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--violet)";

const HEADING =
  "font-mono text-[11px] tracking-widest text-(--muted-foreground) uppercase";

/** Stroke icon wrapper for the contact links. */
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** Renders the footer. */
export default function SiteFooter() {
  return (
    <footer className="border-t border-[#1d1a21] bg-[#0a090c] font-sans">
      <div className="mx-auto flex max-w-7xl flex-col gap-11 px-5 pt-14 pb-8 sm:px-10">
        <div className="flex flex-wrap justify-between gap-10">
          <div className="flex max-w-85 flex-[1_1_260px] flex-col gap-3.5">
            <Link href="/" className="w-fit text-(--foreground)">
              <Logo size={28} />
            </Link>
            <p className="text-sm leading-relaxed text-(--muted-foreground)">
              The workspace that listens, and remembers.
            </p>
          </div>

          <div className="flex flex-wrap gap-x-16 gap-y-10 text-sm">
            <div className="flex flex-col gap-3">
              <span className={HEADING}>Product</span>
              <Link href="/#features" className={LINK}>Features</Link>
              <Link href="/#meetings" className={LINK}>Meetings</Link>
              <Link href="/#demo" className={LINK}>Demo</Link>
              <Link href="/#faq" className={LINK}>FAQ</Link>
            </div>
            <div className="flex flex-col gap-3">
              <span className={HEADING}>Resources</span>
              <Link href="/docs" className={LINK}>Docs</Link>
              <a href="https://github.com/tejasnasa/nimbus" className={LINK}>Source code</a>
              <a href="https://github.com/tejasnasa/nimbus/issues" className={LINK}>Report a bug</a>
            </div>
            <div className="flex flex-col gap-3">
              <span className={HEADING}>Contact</span>
              <Link href="/contact" className={LINK}>
                <Icon>
                  <rect x="3" y="5" width="18" height="14" rx="2" />
                  <path d="M3.5 6.5l8.5 6.5 8.5-6.5" />
                </Icon>
                Email
              </Link>
              <a href="https://github.com/tejasnasa" className={LINK}>
                <Icon>
                  <path d="M9 19c-4.5 1.4-4.5-2.5-6.5-3M15 21v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12 12 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21" />
                </Icon>
                GitHub
              </a>
              <a href="https://twitter.com/tejasnasa" className={LINK}>
                <Icon>
                  <path d="M4 4l16 16M20 4L4 20" />
                </Icon>
                X
              </a>
              <a href="https://tejasnasa.me" className={LINK}>
                <Icon>
                  <circle cx="12" cy="12" r="9" />
                  <path d="M3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z" />
                </Icon>
                Website
              </a>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap justify-between gap-3 border-t border-[#1d1a21] pt-5.5 text-[13px] text-(--muted-foreground)">
          <span>© 2026 Nimbus · MIT License</span>
          <span>Made by Tejas Nasa</span>
        </div>
      </div>
    </footer>
  );
}
