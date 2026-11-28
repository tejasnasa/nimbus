/**
 * @module web/app/error
 * @description The error boundary for every route under the root layout: when
 * a page throws while rendering or loading data, this replaces it with a
 * retry button, a way home, and the error's digest so a report can be matched
 * to the server log.
 *
 * @important Must stay a client component; Next.js passes `reset`, a function.
 *            The message itself is never shown, because in production Next.js
 *            replaces server errors' messages and a client error's message may
 *            not be meant for users.
 */
"use client";

import Link from "next/link";
import { useEffect } from "react";
import {
  AuthHeading,
  StatusShell,
  StatusTiles,
  authPrimaryClass,
  authSecondaryClass,
} from "../components/AuthParts";

/**
 * Renders the error page.
 *
 * @param props.error - The thrown error; `digest` is set for server errors.
 * @param props.reset - Re-renders the segment that failed.
 */
export default function ErrorPage({
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
    <StatusShell maxWidth="max-w-[520px]" centered>
      <StatusTiles mark="!" tone="danger" />

      <AuthHeading title="Something went wrong">
        This page hit an error while loading. Trying again usually fixes it; if
        it keeps happening, let us know what you were doing.
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
        <Link href="/contact" className={authSecondaryClass}>
          Report it
        </Link>
      </div>
    </StatusShell>
  );
}
