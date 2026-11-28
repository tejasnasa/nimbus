/**
 * @module web/components/GoogleButton
 * @description Google OAuth entry shared by the sign-in and signup cards.
 * Starts the social flow through `authClient` and lands on `/home`.
 */
"use client";
import Image from "next/image";
import google from "../assets/google.svg";
import { authClient } from "../lib/auth-client";

/**
 * @param props.children - Button label (e.g. "Continue with Google").
 */
export default function GoogleButton({ children }: { children: string }) {
  return (
    <button
      type="button"
      onClick={async () => {
        await authClient.signIn.social({
          provider: "google",
          callbackURL: `${process.env.NEXT_PUBLIC_FRONTEND_URL}/home`,
        });
      }}
      className="flex min-h-12 w-full cursor-pointer items-center justify-center gap-3 rounded-xl border border-(--line-3) bg-(--surface-1) text-[15px] font-medium text-(--foreground) transition-colors hover:bg-(--surface-3) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--violet)"
    >
      <Image src={google} alt="" width={18} height={18} />
      {children}
    </button>
  );
}
