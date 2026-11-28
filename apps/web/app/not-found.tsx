/**
 * @module web/app/not-found
 * @description The site-wide 404: any address that matches no route, and any
 * `notFound()` call without a closer `not-found` of its own. Shows the
 * requested path and offers the way home and the docs.
 */
import type { Metadata } from "next";
import Link from "next/link";
import {
  AuthHeading,
  StatusShell,
  StatusTiles,
  authPrimaryClass,
  authSecondaryClass,
} from "../components/AuthParts";
import NotFoundPath from "../components/NotFoundPath";

export const metadata: Metadata = {
  title: "Page not found - Nimbus",
  robots: { index: false },
};

/** Renders the 404 page. */
export default function NotFound() {
  return (
    <StatusShell maxWidth="max-w-[520px]" centered>
      <StatusTiles mark="404" />

      <AuthHeading title="This page doesn't exist">
        The link may be broken, or the page may have moved. Check the address,
        or head back to somewhere familiar.
      </AuthHeading>

      <NotFoundPath />

      <div className="flex flex-wrap justify-center gap-2.5">
        <Link href="/" className={`${authPrimaryClass} w-auto! px-[22px]`}>
          Go home
        </Link>
        <Link href="/docs" className={authSecondaryClass}>
          Read the docs
        </Link>
      </div>
    </StatusShell>
  );
}
