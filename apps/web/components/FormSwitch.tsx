"use client";

import { useState } from "react";
import SignupForm from "./SignupForm";
import LoginForm from "./LoginForm";

export default function FormSwitch() {
  const [formType, setFormType] = useState<"login" | "signup">("login");

  return (
    <div className="relative w-full min-h-[530px]">
      <div
        className={`
          absolute inset-0 transition-all duration-300
          ${formType === "login" ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-4 pointer-events-none"}
        `}
      >
        <LoginForm openSignup={() => setFormType("signup")} />
      </div>

      <div
        className={`
          absolute inset-0 transition-all duration-300
          ${formType === "signup" ? "opacity-100 translate-x-0" : "opacity-0 translate-x-4 pointer-events-none"}
        `}
      >
        <SignupForm openLogin={() => setFormType("login")} />
      </div>
    </div>
  );
}
