import { signupSchema } from "@nimbus/types";
import VerifyEmailDialog from "@nimbus/ui/VerifyEmailDialog";
import { UseFormRegister } from "react-hook-form";
import z from "zod";
import {
  AuthDivider,
  AuthError,
  AuthField,
  AuthHeading,
  AuthSubmit,
  PasswordStrengthMeter,
} from "./AuthParts";
import GoogleButton from "./GoogleButton";

/**
 * @module web/components/SignupForm
 * @description Presentational signup card driven by `useSignupForm`: Google
 * OAuth, name + email + password with a strength meter computed from the typed
 * password, a note about email verification, switch to login, and the
 * `VerifyEmailDialog` for the submitted address. Logic lives in the hook.
 */
/** Controlled props from `useSignupForm` plus view-switch callbacks. */
interface SignupFormProps {
  register: UseFormRegister<z.infer<typeof signupSchema>>;
  firstError?: string;
  isSubmitting: boolean;
  onSubmit: (e: React.FormEvent) => void;
  openLogin?: () => void;
  showVerifyDialog: boolean;
  setShowVerifyDialog: (open: boolean) => void;
  submittedEmail: string;
  /** The password as typed, for the strength meter. */
  password?: string;
  /**
   * Whether this is the card currently shown. Inactive cards stay mounted for
   * the crossfade but must not be reachable by keyboard or a screen reader.
   */
  isActive?: boolean;
}

export default function SignupForm({
  register,
  firstError,
  isSubmitting,
  onSubmit,
  openLogin,
  showVerifyDialog,
  setShowVerifyDialog,
  submittedEmail,
  password = "",
  isActive = true,
}: SignupFormProps) {
  return (
    <section className="flex w-full max-w-[400px] flex-col gap-5">
      <AuthHeading title="Create your account">
        Free to start. Bring your team when you&apos;re ready.
      </AuthHeading>

      <form
        className="flex flex-col gap-5"
        onSubmit={onSubmit}
        inert={!isActive}
        aria-hidden={isActive ? undefined : true}
      >
        <GoogleButton>Sign up with Google</GoogleButton>
        <AuthDivider />

        <AuthField
          label="Name"
          id="signup-name"
          placeholder="Tejas Nasa"
          {...register("name")}
        />
        <AuthField
          label="Email"
          id="signup-email"
          placeholder="tejas@example.com"
          {...register("email")}
        />
        <div className="flex flex-col gap-2">
          <AuthField
            label="Password"
            id="signup-password"
            type="password"
            placeholder="••••••••"
            aria-describedby="signup-password-strength"
            {...register("password")}
          />
          <PasswordStrengthMeter
            password={password}
            id="signup-password-strength"
          />
        </div>

        {firstError && <AuthError message={firstError} />}
        <AuthSubmit loading={isSubmitting} arrow>
          Create account
        </AuthSubmit>

        <p className="flex items-start gap-2.5 rounded-[11px] border border-(--line-1) bg-(--surface-1) px-3.5 py-3 text-[13px] leading-normal text-(--muted-foreground)">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--violet)"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mt-0.5 shrink-0"
            aria-hidden="true"
          >
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="M3.5 6.5l8.5 6.5 8.5-6.5" />
          </svg>
          We&apos;ll email you a link to verify your address before your first
          sign-in.
        </p>

        <button
          type="button"
          onClick={openLogin}
          className="cursor-pointer text-center text-sm text-(--muted-foreground)"
        >
          Already have an account?{" "}
          <span className="font-semibold text-(--foreground)">Sign in</span>
        </button>
      </form>

      <VerifyEmailDialog
        open={showVerifyDialog}
        email={submittedEmail}
        onClose={() => setShowVerifyDialog(false)}
      />
    </section>
  );
}
