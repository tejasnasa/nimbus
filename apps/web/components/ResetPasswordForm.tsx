"use client";

import Link from "next/link";
import {
  ArrowRight,
  AuthError,
  AuthField,
  AuthHeading,
  AuthSubmit,
  PasswordStrengthMeter,
  authPrimaryClass,
} from "./AuthParts";
/**
 * @module web/components/ResetPasswordForm
 * @description Self-contained new-password card (owns
 * `useResetPasswordForm(token)`): password + confirm fields with a strength
 * meter computed from the typed password → `done` confirmation with a sign-in
 * link and the auto-redirect to login.
 */
import { useResetPasswordForm } from "../hooks/useResetPasswordForm";

/**
 * @param props.token - Reset token from the emailed link (from the page's search params).
 */
export default function ResetPasswordForm({ token }: { token: string }) {
  const { register, firstError, isSubmitting, onSubmit, done, password } =
    useResetPasswordForm(token);

  if (done) {
    return (
      <section className="flex flex-col gap-[22px]">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-(--lime)">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--background)"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        </div>
        <AuthHeading title="Password updated">
          You can sign in with your new password. Redirecting you to login&hellip;
        </AuthHeading>
        <Link href="/login" className={authPrimaryClass}>
          Sign in
          <ArrowRight />
        </Link>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-[22px]">
      <AuthHeading title="Set a new password">
        Choose a strong password. You&apos;ll be signed out on your other
        devices.
      </AuthHeading>

      <form className="flex flex-col gap-[22px]" onSubmit={onSubmit}>
        <div className="flex flex-col gap-2">
          <AuthField
            label="New password"
            id="new-password"
            type="password"
            placeholder="••••••••"
            aria-describedby="new-password-strength"
            {...register("password")}
          />
          <PasswordStrengthMeter
            password={password}
            id="new-password-strength"
          />
        </div>
        <AuthField
          label="Confirm password"
          id="confirm-password"
          type="password"
          placeholder="••••••••"
          {...register("confirmPassword")}
        />

        {firstError && <AuthError message={firstError} />}

        <AuthSubmit loading={isSubmitting}>Update password</AuthSubmit>
      </form>
    </section>
  );
}
