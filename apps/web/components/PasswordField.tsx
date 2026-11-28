/**
 * @module web/components/PasswordField
 * @description Password input with a show/hide toggle, built on `AuthField`.
 * Extra props (react-hook-form's `register` spread) go to the input.
 */
"use client";
import { useState, type InputHTMLAttributes, type ReactNode } from "react";
import { AuthField } from "./AuthParts";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  id: string;
  label: string;
  labelAside?: ReactNode;
};

/** Password field whose text can be revealed with the eye button. */
export default function PasswordField(props: Props) {
  const [shown, setShown] = useState(false);
  const label = shown ? "Hide password" : "Show password";

  return (
    <AuthField
      {...props}
      type={shown ? "text" : "password"}
      trailing={
        <button
          type="button"
          onClick={() => setShown((v) => !v)}
          aria-label={label}
          aria-pressed={shown}
          className="absolute top-1 right-1 flex size-[38px] cursor-pointer items-center justify-center rounded-lg text-(--muted-foreground) transition-colors hover:text-(--foreground) focus-visible:outline-2 focus-visible:outline-(--violet)"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
            <circle cx="12" cy="12" r="3" />
            {shown && <path d="M4 4l16 16" />}
          </svg>
        </button>
      }
    />
  );
}
