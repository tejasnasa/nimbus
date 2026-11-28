/**
 * @module web/app/contact/page
 * @description Public contact page (server component): prefills the form from
 * the session when there is one and renders it either way. `/contact` is in
 * neither list in `proxy.ts`, so it is reachable signed out and does not bounce
 * a signed-in visitor.
 */
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import ContactForm from "../../components/ContactForm";
import { Eyebrow } from "../../components/landing/parts";
import SiteNavbar from "../../components/SiteNavbar";
import { authClient } from "../../lib/auth-client";

export const metadata: Metadata = {
  title: "Contact - Nimbus",
  description:
    "Report a bug, request a feature, or ask a question about Nimbus.",
};

const OPTION =
  "flex max-w-105 items-center gap-3.5 rounded-[14px] border border-(--line-2) bg-(--surface-1) px-4 py-3.5 text-(--foreground) transition-colors hover:bg-(--surface-3) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--violet)";

const OPTION_ICON =
  "flex size-9.5 shrink-0 items-center justify-center rounded-[11px] bg-(--surface-4)";

export default async function ContactPage() {
  let prefill: { name: string; email: string } | undefined;

  try {
    const { data: session } = await authClient.getSession({
      fetchOptions: { headers: await headers() },
    });

    if (session) {
      prefill = { name: session.user.name, email: session.user.email };
    }
  } catch {
    // The prefill is a convenience, not a requirement: a session read that
    // fails has to leave a usable form behind rather than an error page, since
    // this is the page someone reaches for when something is broken. The
    // submit path reports its own failures.
  }

  return (
    <div className="flex min-h-dvh flex-col overflow-x-clip bg-(--background) font-sans text-(--foreground)">
      <SiteNavbar />

      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-wrap items-start gap-12 px-5 pt-8 pb-24 sm:px-10 sm:pt-12 lg:gap-16">
        <div className="relative flex min-w-0 flex-[1_1_420px] flex-col gap-5.5">
          <Eyebrow>Contact</Eyebrow>
          <h1 className="font-display text-[clamp(40px,4.6vw,60px)] leading-[1.03] font-semibold tracking-[-0.035em]">
            Found a bug?
            <br />
            <span className="text-(--violet)">Have an idea?</span>
          </h1>
          <p className="max-w-115 text-[17px] leading-relaxed text-(--text-body)">
            Tell me what happened or what you&apos;d like to see. Messages go
            straight to my inbox.
          </p>

          <div className="flex flex-col gap-2.5 pt-2.5">
            <a
              href="https://github.com/tejasnasa/nimbus/issues"
              target="_blank"
              rel="noopener noreferrer"
              className={OPTION}
            >
              <span className={OPTION_ICON}>
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--violet)"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M9 19c-4.5 1.4-4.5-2.5-6.5-3M15 21v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12 12 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21" />
                </svg>
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="text-[15px] font-semibold">Open an issue</span>
                <span className="text-[13px] text-(--muted-foreground)">
                  For bugs you can reproduce
                </span>
              </span>
            </a>
            <Link href="/docs" className={OPTION}>
              <span className={OPTION_ICON}>
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--violet)"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M4 5h16v11H8l-4 4z" />
                </svg>
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="text-[15px] font-semibold">Read the docs</span>
                <span className="text-[13px] text-(--muted-foreground)">
                  How it all fits together
                </span>
              </span>
            </Link>
          </div>

          <div
            className="lp-float-tilt pointer-events-none absolute right-2.5 -bottom-10 hidden opacity-[0.22] sm:block"
            aria-hidden="true"
          >
            <svg width="160" height="160" viewBox="0 0 120 120">
              <rect x="22" y="22" width="52" height="52" rx="14" fill="none" stroke="var(--violet)" strokeWidth="6" />
              <rect x="46" y="46" width="52" height="52" rx="14" fill="none" stroke="var(--violet)" strokeWidth="6" />
              <path d="M60 46 H74 V60 A14 14 0 0 1 60 74 H46 V60 A14 14 0 0 1 60 46 Z" fill="var(--lime)" />
            </svg>
          </div>
        </div>

        <section
          aria-label="Contact form"
          className="box-border min-w-0 flex-[1_1_520px] rounded-[22px] border border-(--line-2) bg-(--surface-1) p-6 shadow-[0_30px_80px_rgba(0,0,0,0.4)] sm:p-8"
        >
          <ContactForm prefill={prefill} />
        </section>
      </main>
    </div>
  );
}
