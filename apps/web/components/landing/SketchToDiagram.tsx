/**
 * @module web/components/landing/SketchToDiagram
 * @description The "Snap the whiteboard, get a diagram" section: a hand-drawn
 * sketch on paper with a scanning line, an arrow, and the clean diagram that
 * comes out. Both drawings are inline SVG with text alternatives.
 */
import { Eyebrow, SectionTitle } from "./parts";

const INK = "#2b2a33";

/** Renders the sketch-to-diagram section. */
export default function SketchToDiagram() {
  return (
    <section className="flex flex-wrap items-center gap-14 pt-20 pb-10 sm:pt-25">
      <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-4.5">
        <Eyebrow>Sketch to diagram</Eyebrow>
        <SectionTitle first="Snap the whiteboard," accent="get a diagram." />
        <p className="text-base leading-[1.65] text-(--text-body)">
          Drop a photo of a sketch into chat. Nimbus reads the boxes, arrows and
          labels, and turns them into a clean whiteboard your team can keep
          editing.
        </p>
      </div>

      <div className="flex min-w-0 flex-[1_1_560px] flex-wrap items-center gap-4">
        <div className="relative flex h-70 min-w-0 flex-[1_1_220px] items-center justify-center overflow-hidden rounded-[18px] bg-[#f2ede4]">
          <svg
            width="100%"
            height="240"
            viewBox="0 0 240 240"
            role="img"
            aria-label="Photo of a hand-drawn sign-up flow"
          >
            <path d="M42 32 C82 28 128 30 198 34 C202 50 200 62 196 76 C140 80 88 78 40 74 C38 60 38 46 42 32 Z" fill="none" stroke={INK} strokeWidth="2.4" />
            <path d="M120 80 C118 92 122 100 119 112" fill="none" stroke={INK} strokeWidth="2.2" />
            <path d="M112 104 L119 114 L127 104" fill="none" stroke={INK} strokeWidth="2.2" />
            <path d="M50 118 C96 114 150 116 192 120 C196 136 194 150 190 162 C140 166 92 164 46 160 C44 146 46 132 50 118 Z" fill="none" stroke={INK} strokeWidth="2.4" />
            <path d="M118 166 C121 178 117 186 120 198" fill="none" stroke={INK} strokeWidth="2.2" />
            <path d="M112 190 L120 200 L127 190" fill="none" stroke={INK} strokeWidth="2.2" />
            <text x="120" y="59" textAnchor="middle" fill={INK} fontFamily="Inter, sans-serif" fontSize="15" fontStyle="italic">sign up</text>
            <text x="120" y="145" textAnchor="middle" fill={INK} fontFamily="Inter, sans-serif" fontSize="15" fontStyle="italic">verify email</text>
            <text x="120" y="226" textAnchor="middle" fill={INK} fontFamily="Inter, sans-serif" fontSize="15" fontStyle="italic">workspace!</text>
          </svg>
          <div
            aria-hidden="true"
            className="lp-scan inset-x-0 h-0.75 bg-(--lime) shadow-[0_0_18px_4px_rgba(124,207,0,0.45)]"
          />
        </div>

        <div
          className="lp-flow flex size-11 flex-none items-center justify-center rounded-xl border border-(--line-3) bg-(--surface-3) text-(--lime)"
          aria-hidden="true"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </div>

        <div className="flex h-70 min-w-0 flex-[1_1_220px] items-center justify-center rounded-[18px] border border-(--line-2) bg-(--surface-1)">
          <svg
            width="100%"
            height="240"
            viewBox="0 0 240 240"
            role="img"
            aria-label="Clean editable diagram of the same flow"
          >
            <rect x="50" y="26" width="140" height="48" rx="10" fill="#1f1b24" stroke="var(--violet)" strokeWidth="2" />
            <path d="M120 74 V110" stroke="var(--text-body)" strokeWidth="2" />
            <path d="M114 104 L120 112 L126 104" fill="none" stroke="var(--text-body)" strokeWidth="2" />
            <rect x="50" y="112" width="140" height="48" rx="10" fill="#1f1b24" stroke="var(--violet)" strokeWidth="2" />
            <path d="M120 160 V188" stroke="var(--text-body)" strokeWidth="2" />
            <path d="M114 182 L120 190 L126 182" fill="none" stroke="var(--text-body)" strokeWidth="2" />
            <rect x="64" y="192" width="112" height="36" rx="18" fill="var(--lime)" />
            <text x="120" y="55" textAnchor="middle" fill="var(--foreground)" fontFamily="Inter, sans-serif" fontSize="14">Sign up</text>
            <text x="120" y="141" textAnchor="middle" fill="var(--foreground)" fontFamily="Inter, sans-serif" fontSize="14">Verify email</text>
            <text x="120" y="215" textAnchor="middle" fill="var(--ink)" fontFamily="Inter, sans-serif" fontSize="13" fontWeight="600">Workspace</text>
          </svg>
        </div>
      </div>
    </section>
  );
}
