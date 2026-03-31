"use client";
import { useState } from "react";
import SignupForm from "./SignupForm";
import LoginForm from "./LoginForm";
import { useSignupForm } from "../hooks/useSignupForm";
import { useLoginForm } from "../hooks/useLoginForm";

export default function FormSwitch() {
  const [formType, setFormType] = useState<"login" | "signup">("login");
  const {
    register: signupRegister,
    firstError: signupFirstError,
    isSubmitting: signupIsSubmitting,
    onSubmit: signupOnSubmit,
  } = useSignupForm();
  const {
    register: loginRegister,
    firstError: loginFirstError,
    isSubmitting: loginIsSubmitting,
    onSubmit: loginOnSubmit,
  } = useLoginForm();

  return (
    <>
      <div className="flex md:hidden flex-col items-center justify-center h-screen gap-4 p-8 text-center">
        <div className="w-16 h-16 rounded-2xl bg-(--card)/60 border border-(--border) backdrop-blur-xl flex items-center justify-center mb-2">
          <span className="text-3xl">🖥️</span>
        </div>
        <h1 className="text-xl font-bold tracking-tight">Desktop Only</h1>
        <p className="text-sm text-(--muted-foreground) leading-relaxed max-w-xs">
          Nimbus is designed for desktop browsers. Please switch to a larger
          screen for the best experience.
        </p>
      </div>

      <div className="hidden md:grid relative w-full items-start">
        <div
          className={`
            [grid-area:1/1] transition-all duration-500 ease-out
            ${formType === "login" ? "opacity-100 translate-y-0 scale-100 z-10" : "opacity-0 -translate-y-4 scale-[0.98] pointer-events-none z-0"}
          `}
        >
          <LoginForm
            register={loginRegister}
            firstError={loginFirstError}
            isSubmitting={loginIsSubmitting}
            onSubmit={loginOnSubmit}
            openSignup={() => setFormType("signup")}
          />
        </div>
        <div
          className={`
            [grid-area:1/1] transition-all duration-500 ease-out
            ${formType === "signup" ? "opacity-100 translate-y-0 scale-100 z-10" : "opacity-0 translate-y-4 scale-[0.98] pointer-events-none z-0"}
          `}
        >
          <SignupForm
            register={signupRegister}
            firstError={signupFirstError}
            isSubmitting={signupIsSubmitting}
            onSubmit={signupOnSubmit}
            openLogin={() => setFormType("login")}
          />
        </div>
      </div>
    </>
  );
}
