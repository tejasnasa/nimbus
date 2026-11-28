/**
 * @module web/components/landing/CtaSection
 * @description The closing call to action: a framed panel with the headline,
 * one supporting line, the two buttons and a drifting logo mark in the corner.
 */
import { DemoCta, StartCta } from "./parts";

/** Renders the closing call to action. */
export default function CtaSection() {
  return (
    <section className="pt-20 pb-20 sm:pt-25 sm:pb-25">
      <div className="relative flex flex-col items-center gap-5.5 overflow-hidden rounded-[28px] border border-(--line-3) bg-[#15121a] px-6 py-16 text-center sm:px-10 sm:py-18">
        <div
          className="lp-float absolute -top-15 -right-15 opacity-[0.18]"
          aria-hidden="true"
        >
          <svg width="320" height="320" viewBox="0 0 120 120">
            <rect x="22" y="22" width="52" height="52" rx="14" fill="none" stroke="var(--violet)" strokeWidth="5" />
            <rect x="46" y="46" width="52" height="52" rx="14" fill="none" stroke="var(--violet)" strokeWidth="5" />
            <path d="M60 46 H74 V60 A14 14 0 0 1 60 74 H46 V60 A14 14 0 0 1 60 46 Z" fill="var(--lime)" />
          </svg>
        </div>
        <h2 className="relative max-w-190 font-display text-[clamp(34px,4.4vw,58px)] leading-[1.04] font-semibold tracking-[-0.035em]">
          Your next meeting
          <br />
          <span className="text-(--violet)">already has a note-taker.</span>
        </h2>
        <p className="relative max-w-130 text-[17px] leading-relaxed text-(--text-body)">
          Create a workspace, invite your team, and let Nimbus handle the
          follow-up.
        </p>
        <div className="relative flex flex-wrap justify-center gap-3 pt-1.5">
          <StartCta />
          <DemoCta className="border-[#3a3341]" />
        </div>
      </div>
    </section>
  );
}
