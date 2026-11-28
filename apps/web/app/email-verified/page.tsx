/**
 * @module web/app/email-verified/page
 * @description Landing page for the verification link in the signup email.
 * better-auth redirects here on success and appends `?error=<CODE>` when the
 * link could not be used, so the page renders the verified state, the expired
 * state (`TOKEN_EXPIRED`), or a generic invalid-link state (any other code).
 */
import Link from "next/link";
import {
  ArrowRight,
  AuthHeading,
  StatusShell,
  authPrimaryClass,
} from "../../components/AuthParts";

export default async function EmailVerified({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const expired = error === "TOKEN_EXPIRED";

  return (
    <StatusShell maxWidth="max-w-[440px]" centered>
      <div className="relative size-24">
        <div className="absolute inset-0 flex items-center justify-center rounded-[26px] border border-(--line-2) bg-(--surface-1)">
          <svg
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#d8c2f7"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="5" width="18" height="14" rx="3" />
            <path d="M3.5 7l8.5 6 8.5-6" />
          </svg>
        </div>
        <span
          className={`absolute -right-2 -bottom-2 flex size-[34px] items-center justify-center rounded-full border-4 border-(--background) ${
            error ? "bg-[#fdba74]" : "bg-(--lime)"
          }`}
        >
          {error ? (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--background)"
              strokeWidth="3.2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M12 6v8M12 18.5v.5" />
            </svg>
          ) : (
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--background)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          )}
        </span>
      </div>

      {error ? (
        <>
          <AuthHeading
            title={expired ? "This link has expired" : "This link didn't work"}
          >
            {expired
              ? "Verification links only last a while. Sign in with your email and password and we'll send you a fresh one."
              : "The link is invalid or has already been used. Sign in with your email and password and we'll send you a fresh one if you still need to verify."}
          </AuthHeading>
          <Link href="/login" className={authPrimaryClass}>
            Back to sign in
          </Link>
        </>
      ) : (
        <>
          <AuthHeading title="You are verified">
            Your email is confirmed. You can now sign in to your account.
          </AuthHeading>
          <Link href="/login" className={authPrimaryClass}>
            Continue to sign in
            <ArrowRight />
          </Link>
        </>
      )}
    </StatusShell>
  );
}
