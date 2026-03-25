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
      {/* shown only on mobile */}
      <div className="flex md:hidden flex-col items-center justify-center h-screen gap-4 p-8 text-center">
        <span className="text-4xl">🖥️</span>
        <h1 className="text-xl font-semibold">Desktop Only</h1>
        <p className="text-sm text-(--muted-foreground)">
          This website is not meant for mobile phones. Please open it on a
          desktop browser.
        </p>
      </div>

      {/* shown only on desktop */}
      <div className="hidden md:block relative w-full min-h-140">
        <div
          className={`
            absolute inset-0 transition-all duration-300 mt-10
            ${formType === "login" ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-4 pointer-events-none"}
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
            absolute inset-0 transition-all duration-300
            ${formType === "signup" ? "opacity-100 translate-x-0" : "opacity-0 translate-x-4 pointer-events-none"}
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
