"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Button from "./Button";

type Props = {
  open: boolean;
  email: string;
  onClose: () => void;
};

export default function VerifyEmailDialog({ open, email, onClose }: Props) {
  const [mounted, setMounted] = useState(false);
  const router = useRouter();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (open) document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [open, onClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-(--background)/60 backdrop-blur-md"
        onClick={onClose}
        style={{ animation: "fade-in 0.2s ease-out" }}
      />
      <div
        className="relative z-[51] w-full max-w-md mx-4 bg-(--background) border border-(--border) rounded-2xl p-6 flex flex-col gap-4"
        style={{ animation: "scale-in 0.3s ease-out" }}
      >
        <div className="flex flex-col gap-1">
          <h2 className=" mb-4 font-semibold text-2xl">Check your email</h2>
          <p className="text-sm text-(--muted-foreground)">
            We sent a verification link to{" "}
            <span className="text-(--foreground) font-medium">{email}</span>.
            Please verify before logging in.
          </p>
        </div>

        <div className="flex flex-col gap-2 pt-2">
          <Button
            onClick={() => {
              onClose();
              router.push("/login");
            }}
            className="cursor-pointer"
          >
            I&apos;ve Verified — Go To Login
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
