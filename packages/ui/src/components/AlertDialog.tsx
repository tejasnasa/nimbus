"use client";
import { useState, useEffect } from "react";

type AlertDialogControls = {
  open: () => void;
  close: () => void;
};

type Props = {
  trigger: React.ReactNode;
  onConfirm?: () => void;
  children: React.ReactNode | ((controls: AlertDialogControls) => React.ReactNode);
};

export default function AlertDialog({
  trigger,
  onConfirm,
  children,
}: Props) {
  const [open, setOpen] = useState(false);

  const controls: AlertDialogControls = {
    open: () => setOpen(true),
    close: () => setOpen(false),
  };

  useEffect(() => {
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    if (open) document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [open]);

  return (
    <>
      <div onClick={() => setOpen(true)} className="inline-block">
        {trigger}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-(--background)/30 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />

          {typeof children === "function" ? children(controls) : children}

          {/* <div
            className="
              relative z-50 w-full max-w-120 rounded-lg border border-(--border) bg-(--background) p-8 shadow-lg animate-in fade-in zoom-in-95
            "
          >
            <div className="space-y-2">
              <h2 className="text-xl font-semibold text-(--foreground)">
                {title}
              </h2>
              <p className="text-md text-(--muted-foreground)">{description}</p>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <Button onClick={() => setOpen(false)} size="sm">
                Cancel
              </Button>

              <Button
                onClick={() => {
                  onConfirm?.();
                  setOpen(false);
                }}
                className=" bg-red-500 hover:bg-red-600"
                size="sm"
              >
                Continue
              </Button>
            </div>
          </div> */}
        </div>
      )}
    </>
  );
}
