"use client";
import { useState, useEffect } from "react";

type Props = {
  trigger: React.ReactNode;
  children: React.ReactNode;
};

export default function AlertDialog({ trigger, children }: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    if (open) document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [open]);

  return (
    <>
      <div onClick={() => setOpen(true)} className="inline-block w-fit mx-auto">
        {trigger}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-(--background)/30 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />

          <div
            className="relative z-50"
            onClick={(e) => {
              const target = e.target as HTMLElement | null;
              if (target?.closest("[data-alert-dialog-close]")) {
                setOpen(false);
              }
            }}
          >
            {children}
          </div>
        </div>
      )}
    </>
  );
}
