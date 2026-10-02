/**
 * @module web/app/contact/page
 * @description Public contact page (server component): prefills the form from
 * the session when there is one and renders it either way. `/contact` is in
 * neither list in `proxy.ts`, so it is reachable signed out and does not bounce
 * a signed-in visitor.
 */
import Cloud from "@nimbus/ui/icons/Cloud";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import ContactForm from "../../components/ContactForm";
import { authClient } from "../../lib/auth-client";

export const metadata: Metadata = {
  title: "Contact - Nimbus",
  description:
    "Report a bug, request a feature, or ask a question about Nimbus.",
};

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
    <main className="min-h-dvh bg-(--background) text-(--foreground) relative overflow-x-hidden">
      <div className="absolute inset-0 bg-grid opacity-30 pointer-events-none" />
      <div className="absolute top-0 right-0 w-125 h-125 bg-(--primary)/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-100 h-100 bg-(--sidebar-primary)/8 rounded-full blur-3xl pointer-events-none" />

      <nav className="relative z-10 px-8 py-5">
        <Link
          href="/"
          className="flex items-center gap-2.5 font-semibold text-lg group w-fit"
        >
          <div className="flex size-9 items-center justify-center rounded-lg text-(--primary-foreground) group-hover:scale-110 transition-transform duration-300">
            <Cloud />
          </div>
          <span className="tracking-tight">Nimbus</span>
        </Link>
      </nav>

      <div className="relative z-10 px-6 pt-8 pb-20">
        <div className="w-full max-w-xl mx-auto animate-slide-up">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold tracking-tight mb-3">
              Get in touch
            </h1>
            <p className="text-sm text-(--muted-foreground) leading-relaxed">
              Report a bug, request a feature, or ask a question.
            </p>
          </div>

          <ContactForm prefill={prefill} />
        </div>
      </div>
    </main>
  );
}
