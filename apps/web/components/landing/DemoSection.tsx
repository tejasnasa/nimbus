/**
 * @module web/components/landing/DemoSection
 * @description The "One meeting, start to notes" section: a 16:9 stage for the
 * product demo and the list of chapters it covers.
 *
 * @important No demo video is published yet, so the stage is a decorative
 *            frame with a plain-text note, not a playable control. When a video
 *            exists, replace the frame's contents with its embed; a dead play
 *            button would promise something the page cannot do.
 */
import { Eyebrow, SectionTitle } from "./parts";

const CHAPTERS = [
  "Joining a call",
  "Live, translated captions",
  "Asking Nimbus out loud",
  "Notes and action items",
];

/** Renders the demo section. */
export default function DemoSection() {
  return (
    <section
      id="demo"
      className="flex scroll-mt-4 flex-col items-center gap-9 pt-20 pb-10 text-center sm:pt-25"
    >
      <div className="flex max-w-190 flex-col items-center gap-4">
        <Eyebrow>Demo</Eyebrow>
        <SectionTitle first="One meeting," accent="start to notes." />
        <p className="text-base leading-relaxed text-(--text-body)">
          A real call in a real workspace: captions, a question to Nimbus, and
          the notes it writes when everyone hangs up.
        </p>
      </div>

      <div className="relative flex aspect-video w-full max-w-260 items-center justify-center overflow-hidden rounded-[22px] border border-(--line-2) bg-(--surface-1) shadow-[0_40px_100px_rgba(0,0,0,0.5)]">
        <div
          className="lp-spin absolute size-225 opacity-[0.08]"
          aria-hidden="true"
        >
          <svg width="900" height="900" viewBox="0 0 120 120" className="size-full">
            <rect x="22" y="22" width="52" height="52" rx="14" fill="none" stroke="var(--violet)" strokeWidth="1.2" />
            <rect x="46" y="46" width="52" height="52" rx="14" fill="none" stroke="var(--violet)" strokeWidth="1.2" />
          </svg>
        </div>
        <div className="relative flex flex-col items-center gap-4.5">
          <div className="relative size-24" aria-hidden="true">
            <span className="lp-ring absolute inset-0 rounded-full border-2 border-(--violet)" />
            <span className="absolute inset-0 flex items-center justify-center rounded-full bg-(--brand) text-white">
              <svg width="34" height="34" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5.5v13l11-6.5z" />
              </svg>
            </span>
          </div>
          <span className="font-mono text-xs text-(--muted-foreground)">
            Demo video coming soon
          </span>
        </div>
      </div>

      <ol className="flex flex-wrap justify-center gap-2.5">
        {CHAPTERS.map((c, i) => (
          <li
            key={c}
            className="rounded-[10px] border border-(--line-2) bg-(--surface-1) px-3.5 py-2 text-[13px] text-(--text-soft)"
          >
            <span className="font-mono text-(--violet)">0{i + 1}</span> {c}
          </li>
        ))}
      </ol>
    </section>
  );
}
