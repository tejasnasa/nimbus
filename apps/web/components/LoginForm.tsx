import { loginSchema } from "@nimbus/types";
import { UseFormRegister } from "react-hook-form";
import z from "zod";
import type { ResendState } from "../hooks/useLoginForm";
import {
  AuthDivider,
  AuthError,
  AuthField,
  AuthHeading,
  AuthSubmit,
} from "./AuthParts";
import GoogleButton from "./GoogleButton";
import PasswordField from "./PasswordField";

/**
 * @module web/components/LoginForm
 * @description Presentational sign-in card driven by `useLoginForm`: Google
 * OAuth (`callbackURL: /home`), email + password fields with a show/hide
 * toggle, forgot-password link, error banner (with a resend link for an
 * unverified email), and a switch to signup. All logic lives in the hook —
 * this component only renders props.
 */
/** Controlled props from `useLoginForm` plus view-switch callbacks. */
interface LoginFormProps {
  register: UseFormRegister<z.infer<typeof loginSchema>>;
  firstError?: string;
  isSubmitting: boolean;
  onSubmit: (e: React.FormEvent) => void;
  openSignup?: () => void;
  openForgotPassword?: () => void;
  /** The address that still needs verifying, when sign-in was refused for it. */
  unverifiedEmail?: string | null;
  /** Where a resend of the verification email stands. */
  resendState?: ResendState;
  /** Sends the verification email again. */
  onResendVerification?: () => void;
  /**
   * Whether this is the card currently shown. Inactive cards stay mounted for
   * the crossfade but must not be reachable by keyboard or a screen reader.
   */
  isActive?: boolean;
}

export default function LoginForm({
  register,
  firstError,
  isSubmitting,
  onSubmit,
  openSignup,
  openForgotPassword,
  unverifiedEmail,
  resendState = "idle",
  onResendVerification,
  isActive = true,
}: LoginFormProps) {
  return (
    <section className="flex w-full max-w-[400px] flex-col gap-[22px]">
      <AuthHeading title="Welcome back">
        Sign in to pick up where your team left off.
      </AuthHeading>

      <form
        className="flex flex-col gap-[22px]"
        onSubmit={onSubmit}
        inert={!isActive}
        aria-hidden={isActive ? undefined : true}
      >
        <GoogleButton>Continue with Google</GoogleButton>
        <AuthDivider />

        <AuthField
          label="Email"
          id="login-email"
          placeholder="tejas@example.com"
          {...register("email")}
        />
        <PasswordField
          label="Password"
          id="login-password"
          placeholder="••••••••"
          labelAside={
            <button
              type="button"
              onClick={openForgotPassword}
              className="cursor-pointer text-(--violet-soft) hover:underline"
            >
              Forgot password?
            </button>
          }
          {...register("password")}
        />

        {firstError && <AuthError message={firstError} />}
        {unverifiedEmail && onResendVerification && (
          <div className="flex items-center justify-between gap-2 text-xs text-(--muted-foreground)">
            <span role="status" data-testid="resend-verification-status">
              {resendState === "sent"
                ? `Sent again to ${unverifiedEmail}.`
                : resendState === "error"
                  ? "Could not send it. Try again in a minute."
                  : "No email?"}
            </span>
            <button
              type="button"
              onClick={onResendVerification}
              disabled={resendState === "sending"}
              className="cursor-pointer font-medium text-(--violet-soft) hover:underline disabled:cursor-not-allowed disabled:opacity-60"
            >
              {resendState === "sending"
                ? "Sending…"
                : "Resend verification email"}
            </button>
          </div>
        )}

        <AuthSubmit loading={isSubmitting} arrow>
          Sign in
        </AuthSubmit>

        <button
          type="button"
          onClick={openSignup}
          className="cursor-pointer text-center text-sm text-(--muted-foreground)"
        >
          New to Nimbus?{" "}
          <span className="font-semibold text-(--foreground)">Sign up</span>
        </button>
      </form>
    </section>
  );
}
