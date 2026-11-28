/**
 * @module web/components/landing/parts
 * @description Small presentational pieces repeated through the landing page:
 * the section eyebrow, the two-tone section heading, the primary and secondary
 * calls to action, the lime tick used in bullet lists, and the mark glyph.
 * Free of hooks so server components can render them.
 */
import Link from "next/link";
import type { ReactNode } from "react";

/** Section label in small mono capitals. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="font-mono text-xs tracking-[0.12em] text-(--violet) uppercase">
      {children}
    </span>
  );
}

/**
 * Section heading: a plain first line and an accent-coloured second line.
 *
 * @param props.first - The first line, in the foreground colour.
 * @param props.accent - The second line, in the accent colour.
 */
export function SectionTitle({
  first,
  accent,
}: {
  first: string;
  accent: string;
}) {
  return (
    <h2 className="font-display text-[clamp(34px,4vw,52px)] leading-[1.05] font-semibold tracking-[-0.03em]">
      {first}
      <br />
      <span className="text-(--violet)">{accent}</span>
    </h2>
  );
}

/** Lime check mark used on bullet lists. */
export function CheckIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--lime)"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="mt-0.5 shrink-0"
      aria-hidden="true"
    >
      <path d="M5 12l5 5 9-10" />
    </svg>
  );
}

/** The primary call to action: sign up. */
export function StartCta() {
  return (
    <Link
      href="/login"
      className="inline-flex min-h-12 items-center gap-2.5 rounded-xl bg-(--brand) pr-2 pl-5.5 text-[15px] font-semibold text-white transition-colors hover:bg-(--brand)/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--violet)"
    >
      Start for free
      <span className="inline-flex size-8 items-center justify-center">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </span>
    </Link>
  );
}

/**
 * The secondary call to action, which scrolls to the demo.
 *
 * @param props.className - Border colour override.
 */
export function DemoCta({ className = "border-(--line-3)" }: { className?: string }) {
  return (
    <Link
      href="/#demo"
      className={`inline-flex min-h-12 items-center gap-2.5 rounded-xl border px-5.5 text-[15px] font-medium text-(--foreground) transition-colors hover:bg-(--surface-1) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--violet) ${className}`}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="2" y="7" width="20" height="14" rx="2" />
        <path d="M8 2l4 5 4-5" />
        <path d="M10.5 11.5v5l4-2.5z" />
      </svg>
      Watch demo
    </Link>
  );
}

/**
 * The lime rounded-square glyph used as a bullet in the notes preview.
 *
 * @param props.className - Extra classes for sizing and spacing.
 */
export function MarkGlyph({ className = "" }: { className?: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 120 120"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
    >
      <path
        d="M60 22 H98 V60 A38 38 0 0 1 60 98 H22 V60 A38 38 0 0 1 60 22 Z"
        fill="var(--lime)"
      />
    </svg>
  );
}

/**
 * Classes that fade and lift an element in when `on` turns true.
 *
 * @param on - Whether the element is revealed.
 */
export function reveal(on: boolean): string {
  return `transition-[opacity,transform] duration-500 motion-reduce:transition-none ${
    on ? "translate-y-0 opacity-100" : "translate-y-2.5 opacity-0"
  }`;
}
