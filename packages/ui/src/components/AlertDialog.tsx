"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

/**
 * @module ui/components/AlertDialog
 * @description Modal confirmation dialog with portal rendering, backdrop
 * fade/scale, Escape/backdrop/inside close affordances, real focus
 * management, body scroll lock, and ARIA semantics.
 *
 * Two modes coexist for backwards compatibility:
 *  - **Uncontrolled** (`trigger` provided, `open`/`onOpenChange` absent):
 *    the trigger owns the open state. Existing consumers keep working
 *    unchanged and get the a11y fixes for free.
 *  - **Controlled** (`open` + `onOpenChange` provided): the parent owns the
 *    state. `trigger` becomes optional — the parent can open the dialog from
 *    a button it renders elsewhere (e.g. composer's "Add API key" button).
 *    Backdrop and Escape both call `onOpenChange(false)` rather than
 *    closing locally, so an in-flight submit can survive a failed attempt.
 *
 * @important The dialog mounts on `document.body` so its stacking context is
 *            not nested in a `transform`/`overflow:hidden` ancestor. SSR
 *            guards the mount through a `mounted` state.
 */
type Props = {
  /** Clickable element that opens the dialog. Ignored in controlled mode. */
  trigger?: ReactNode;
  /** Dialog panel content rendered inside the portal. */
  children: ReactNode;
  /** Controlled open state. When defined, `onOpenChange` must be too. */
  open?: boolean;
  /** Called with the next open value when the dialog wants to close. */
  onOpenChange?: (open: boolean) => void;
};

/**
 * The set of selectors for elements that are considered focusable inside the
 * dialog. Matches the HTML a11y canon, minus `tabindex="-1"` anchors (which
 * are intentionally not part of the keyboard rotation).
 */
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/**
 * Confirmation modal with portal rendering, focus trap, and ARIA semantics.
 *
 * Behaviour:
 *  - Closes on Escape, backdrop click, or any descendant with
 *    `[data-alert-dialog-close]`.
 *  - On open: scrolls the body to the top, locks further scroll, focuses the
 *    first focusable element, and remembers which element was focused so it
 *    can be restored on close.
 *  - Tab and Shift+Tab cycle within the focusable set inside the panel.
 */
export default function AlertDialog({
  trigger,
  children,
  open: openProp,
  onOpenChange,
}: Props) {
  // `open` is the resolved open state. When controlled, it mirrors the prop
  // exactly; when uncontrolled, it's the local state and `trigger` toggles it.
  const isControlled = openProp !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  const open = isControlled ? openProp : internalOpen;

  const setOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  const panelRef = useRef<HTMLDivElement>(null);
  /** The element focused when the dialog opened, restored on close. */
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  /** Closes via any of the three affordances. */
  const closeDialog = useCallback(() => setOpen(false), [setOpen]);

  useEffect(() => {
    if (!open) return;
    if (!mounted) return;

    // Remember focus so the user returns to wherever they were when they
    // opened the dialog. `document.activeElement` is `body` on a fresh open.
    lastFocusedRef.current =
      (document.activeElement as HTMLElement | null) ?? null;

    // Lock background scroll while the modal is up so a long page behind it
    // does not jump on close.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Focus the first focusable element in the panel. Deferred so the panel
    // is in the DOM when we query it.
    const panel = panelRef.current;
    if (panel) {
      const focusables =
        panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      const first = focusables[0];
      if (first) {
        first.focus();
      } else {
        panel.setAttribute("tabindex", "-1");
        panel.focus();
      }
    }

    return () => {
      document.body.style.overflow = prevOverflow;
      // Restore focus to the trigger or whatever was focused before open.
      lastFocusedRef.current?.focus?.();
    };
  }, [open, mounted]);

  // Escape and Tab/Shift-Tab live on `document` because the focusable
  // elements are inside a portal. The Escape listener is only attached while
  // the dialog is open so it does not interfere with other components.
  useEffect(() => {
    if (!open) return;
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") closeDialog();
    }
    function handleTab(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      if (focusables.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleEsc);
    document.addEventListener("keydown", handleTab);
    return () => {
      document.removeEventListener("keydown", handleEsc);
      document.removeEventListener("keydown", handleTab);
    };
  }, [open, closeDialog]);

  return (
    <>
      {!isControlled && trigger && (
        <div
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
          className="inline-flex w-full sm:w-auto h-full"
        >
          {trigger}
        </div>
      )}

      {open &&
        mounted &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div
              className="absolute inset-0 bg-(--background)/60 backdrop-blur-md"
              onClick={closeDialog}
              style={{ animation: "fade-in 0.2s ease-out" }}
              aria-hidden="true"
            />

            <div
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              className="relative z-[51] outline-none"
              style={{ animation: "scale-in 0.3s ease-out" }}
              onClick={(e) => {
                const target = e.target as HTMLElement | null;
                if (target?.closest("[data-alert-dialog-close]")) {
                  setOpen(false);
                }
              }}
            >
              {children}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
