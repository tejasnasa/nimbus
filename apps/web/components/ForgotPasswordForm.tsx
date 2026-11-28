"use client";

import { useForgotPasswordForm } from "../hooks/useForgotPasswordForm";
import {
  AuthError,
  AuthField,
  AuthHeading,
  AuthSubmit,
} from "./AuthParts";

/**
 * @module web/components/ForgotPasswordForm
 * @description Self-contained reset-request card (owns
 * `useForgotPasswordForm`): email field → `sent` "check your inbox"
 * confirmation with a way back to try another address, and a back-to-login
 * link. Rendered inside `FormSwitch`.
 */
interface ForgotPasswordFormProps {
  openLogin: () => void;
  /**
   * Whether this is the card currently shown. Inactive cards stay mounted for
   * the crossfade but must not be reachable by keyboard or a screen reader.
   */
  isActive?: boolean;
}

function BackToSignIn({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex w-fit cursor-pointer items-center gap-2 text-sm text-(--muted-foreground) hover:text-(--foreground)"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M19 12H5M11 18l-6-6 6-6" />
      </svg>
      Back to login
    </button>
  );
}

export default function ForgotPasswordForm({
  openLogin,
  isActive = true,
}: ForgotPasswordFormProps) {
  const { register, firstError, isSubmitting, onSubmit, sent, email, reset } =
    useForgotPasswordForm();

  if (sent) {
    return (
      <section
        className="flex w-full max-w-[400px] flex-col gap-[22px]"
        inert={!isActive}
        aria-hidden={isActive ? undefined : true}
      >
        <div className="relative flex size-14 items-center justify-center rounded-2xl border border-(--line-2) bg-(--surface-1)">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#d8c2f7"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="5" width="18" height="14" rx="3" />
            <path d="M3.5 7l8.5 6 8.5-6" />
          </svg>
          <span className="absolute -top-1.5 -right-1.5 size-[18px] rounded-full border-[3px] border-(--background) bg-(--lime)" />
        </div>
        <AuthHeading title="Check your inbox">
          If an account exists for{" "}
          <span className="text-(--foreground)">{email}</span>, a reset link has
          been sent.
        </AuthHeading>
        <div className="rounded-[14px] border border-(--line-1) bg-(--surface-1) px-4 py-3.5 text-sm text-(--muted-foreground)">
          Check spam, or{" "}
          <button
            type="button"
            onClick={reset}
            className="cursor-pointer font-medium text-(--foreground) hover:underline"
          >
            try another email
          </button>
          .
        </div>
        <BackToSignIn onClick={openLogin} />
      </section>
    );
  }

  return (
    <section className="flex w-full max-w-[400px] flex-col gap-[22px]">
      <AuthHeading title="Forgot your password?">
        Enter the email you signed up with and we&apos;ll send you a link to
        set a new one.
      </AuthHeading>

      <form
        className="flex flex-col gap-[22px]"
        onSubmit={onSubmit}
        inert={!isActive}
        aria-hidden={isActive ? undefined : true}
      >
        <AuthField
          label="Email"
          id="forgot-email"
          placeholder="tejas@example.com"
          {...register("email")}
        />

        {firstError && <AuthError message={firstError} />}

        <AuthSubmit loading={isSubmitting}>Send reset link</AuthSubmit>
        <BackToSignIn onClick={openLogin} />
      </form>
    </section>
  );
}
