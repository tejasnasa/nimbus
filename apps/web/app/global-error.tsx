/**
 * @module web/app/global-error
 * @description Last-resort error page for a failure in the root layout itself,
 * where `app/error.tsx` cannot help because it renders inside that layout. It
 * replaces the whole document, so it brings its own `<html>`, `<body>` and
 * global CSS, and uses only plain markup.
 *
 * @important The root layout's fonts and providers are not mounted here, so
 *            text falls back to the system font stacks behind the font
 *            tokens. Keep this page free of anything that needs a provider.
 */
"use client";

import Link from "next/link";
import { useEffect } from "react";
import "./globals.css";
import {
  AuthHeading,
  StatusShell,
  StatusTiles,
  authPrimaryClass,
  authSecondaryClass,
} from "../components/AuthParts";

/**
 * Renders the full-document error page.
 *
 * @param props.error - The thrown error; `digest` is set for server errors.
 * @param props.reset - Re-renders the root layout.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <StatusShell maxWidth="max-w-[520px]" centered>
          <StatusTiles mark="!" tone="danger" />

          <AuthHeading title="Nimbus couldn't load">
            Something broke before the page could start. Try again, and if it
            keeps happening, let us know.
          </AuthHeading>

          {error.digest && (
            <span className="inline-flex items-center gap-2 rounded-[10px] border border-(--line-1) bg-(--surface-1) px-3 py-2 font-mono text-xs text-(--muted-foreground)">
              <span className="text-(--text-dim)">ref</span>
              {error.digest}
            </span>
          )}

          <div className="flex flex-wrap justify-center gap-2.5">
            <button
              type="button"
              onClick={reset}
              className={`${authPrimaryClass} w-auto! px-[22px]`}
            >
              Try again
            </button>
            <Link href="/" className={authSecondaryClass}>
              Go home
            </Link>
          </div>
        </StatusShell>
      </body>
    </html>
  );
}
