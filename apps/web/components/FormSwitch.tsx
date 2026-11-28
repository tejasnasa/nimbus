/**
 * @module web/components/FormSwitch
 * @description Auth screen: a form column (logo plus the login, signup and
 * forgot-password cards, switched with a crossfade grid-stack transition) next
 * to a decorative panel that follows the view. Shows a desktop-only notice on
 * small screens. Owns both form hooks so state persists across view switches.
 *
 * @important Renders its columns as direct children of the page's flex
 * container (`app/login/page.tsx`), so the two must change together.
 */
"use client";
import { useState } from "react";
import { useLoginForm } from "../hooks/useLoginForm";
import { useSignupForm } from "../hooks/useSignupForm";
import LoginForm from "./LoginForm";
import SignupForm from "./SignupForm";
import ForgotPasswordForm from "./ForgotPasswordForm";
import AuthCallPreview from "./AuthCallPreview";
import AuthPerks from "./AuthPerks";
import { AuthLogoLink } from "./AuthParts";

export default function FormSwitch() {
  const [formType, setFormType] = useState<"login" | "signup" | "forgot">(
    "login",
  );
  const {
    register: signupRegister,
    firstError: signupFirstError,
    isSubmitting: signupIsSubmitting,
    onSubmit: signupOnSubmit,
    showVerifyDialog,
    setShowVerifyDialog,
    submittedEmail,
    password: signupPassword,
  } = useSignupForm();
  const {
    register: loginRegister,
    firstError: loginFirstError,
    isSubmitting: loginIsSubmitting,
    onSubmit: loginOnSubmit,
    unverifiedEmail,
    resendState,
    resendVerification,
  } = useLoginForm();

  const cardClass = (view: typeof formType, hidden: string) =>
    `[grid-area:1/1] flex items-center justify-center transition-all duration-500 ease-out motion-reduce:transition-none ${
      formType === view
        ? "z-10 translate-y-0 scale-100 opacity-100"
        : `pointer-events-none z-0 scale-[0.98] opacity-0 ${hidden}`
    }`;

  return (
    <>
      <div className="flex min-h-dvh w-full flex-col items-center justify-center gap-4 p-8 text-center md:hidden">
        <div className="mb-2 flex size-16 items-center justify-center rounded-2xl border border-(--border) bg-(--card)/60 backdrop-blur-xl">
          <span className="text-3xl">🖥️</span>
        </div>
        <h1 className="text-xl font-bold tracking-tight">Desktop Only</h1>
        <p className="max-w-xs text-sm leading-relaxed text-(--muted-foreground)">
          Nimbus is designed for desktop browsers. Please switch to a larger
          screen for the best experience.
        </p>
      </div>

      <div className="hidden min-w-0 flex-[1_1_520px] flex-col px-10 py-8 md:flex">
        <AuthLogoLink />
        <div className="grid flex-1 items-center py-12">
          <div className={cardClass("login", "-translate-y-4")}>
            <LoginForm
              register={loginRegister}
              firstError={loginFirstError}
              isSubmitting={loginIsSubmitting}
              onSubmit={loginOnSubmit}
              openSignup={() => setFormType("signup")}
              openForgotPassword={() => setFormType("forgot")}
              unverifiedEmail={unverifiedEmail}
              resendState={resendState}
              onResendVerification={() => void resendVerification()}
              isActive={formType === "login"}
            />
          </div>
          <div className={cardClass("forgot", "-translate-y-4")}>
            <ForgotPasswordForm
              openLogin={() => setFormType("login")}
              isActive={formType === "forgot"}
            />
          </div>
          <div className={cardClass("signup", "translate-y-4")}>
            <SignupForm
              register={signupRegister}
              firstError={signupFirstError}
              isSubmitting={signupIsSubmitting}
              onSubmit={signupOnSubmit}
              openLogin={() => setFormType("login")}
              showVerifyDialog={showVerifyDialog}
              setShowVerifyDialog={setShowVerifyDialog}
              submittedEmail={submittedEmail}
              password={signupPassword}
              isActive={formType === "signup"}
            />
          </div>
        </div>
      </div>

      <div className="relative hidden min-w-0 flex-[1_1_560px] items-center justify-center overflow-hidden border-l border-(--line-1) bg-(--panel) px-10 py-12 md:flex">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-[4%] -right-[14%] size-[560px] rounded-full bg-[radial-gradient(circle,rgba(124,58,237,0.16),transparent_65%)]"
        />
        <div
          className={`flex w-full justify-center transition-opacity duration-500 motion-reduce:transition-none ${
            formType === "signup" ? "opacity-0" : "opacity-100"
          }`}
        >
          <AuthCallPreview />
        </div>
        <div
          className={`absolute inset-0 flex items-center justify-center overflow-hidden px-10 transition-opacity duration-500 motion-reduce:transition-none ${
            formType === "signup" ? "opacity-100" : "opacity-0"
          }`}
        >
          <AuthPerks />
        </div>
      </div>
    </>
  );
}
