/**
 * @module web/components/landing/MeetingSteps
 * @description The "Nimbus in your meetings" section: a progress rail and four
 * cards (listens, captions, answers, writes it up). The highlighted card
 * advances on a timer to walk through the flow.
 *
 * @important The cards themselves are real text and read in order for
 *            assistive tech; only the highlight is decorative. Under reduced
 *            motion the last step stays highlighted.
 */
"use client";
import { Eyebrow, SectionTitle } from "./parts";
import { useTick } from "./useTick";

const STEPS = [
  {
    title: "Listens",
    text: "Start Nimbus in a call and it transcribes each person on their own track, so every line has a name on it.",
    sample: "Marco: I can have it behind a flag by Thursday.",
  },
  {
    title: "Captions",
    text: "Everyone reads along live, and each viewer picks the language their captions arrive in.",
    sample: "ES · ¿Mantenemos también el acceso con Google?",
  },
  {
    title: "Answers",
    text: "Say “Nimbus, …” or hold Ask. It answers out loud from this and earlier meetings, and stops when someone talks over it.",
    sample: "“Last Tuesday you kept Google sign-in.”",
  },
  {
    title: "Writes it up",
    text: "When the call ends you get notes, decisions and owned action items. Late joiners can ask it to catch them up.",
    sample: "✓ Marco · magic link behind a flag · Thu",
  },
];

/** Renders the meetings section. */
export default function MeetingSteps() {
  const { tick, animate } = useTick();
  const stage = animate ? Math.floor(tick / 4) % STEPS.length : STEPS.length - 1;

  return (
    <section id="meetings" className="flex scroll-mt-4 flex-col gap-11 pt-20 pb-10 sm:pt-25">
      <div className="flex max-w-190 flex-col gap-4">
        <Eyebrow>Nimbus in your meetings</Eyebrow>
        <SectionTitle
          first="It joins the call,"
          accent="and does the follow-up."
        />
      </div>
      <div
        className="h-1 overflow-hidden rounded-xs bg-(--surface-4)"
        aria-hidden="true"
      >
        <div
          className="h-1 rounded-xs bg-(--lime) transition-[width] duration-600 motion-reduce:transition-none"
          style={{ width: `${(stage + 1) * 25}%` }}
        />
      </div>
      <ol className="flex flex-wrap gap-5">
        {STEPS.map((s, i) => {
          const on = i === stage;
          return (
            <li
              key={s.title}
              className={`box-border flex min-h-75 min-w-0 flex-[1_1_240px] flex-col gap-3.5 rounded-[18px] border p-6 transition-[border-color,background-color,transform] duration-400 motion-reduce:transition-none ${
                on
                  ? "-translate-y-1.5 border-(--violet) bg-(--surface-3)"
                  : "border-(--line-2) bg-(--surface-1)"
              }`}
            >
              <div className="flex items-center justify-between">
                <span
                  className={`font-mono text-xs ${on ? "text-(--lime)" : "text-(--muted-foreground)"}`}
                >
                  0{i + 1}
                </span>
                <span
                  aria-hidden="true"
                  className={`size-2.5 rounded-full transition-colors duration-300 ${on ? "bg-(--lime)" : "bg-(--line-3)"}`}
                />
              </div>
              <h3 className="font-display text-[22px] font-semibold tracking-[-0.02em]">
                {s.title}
              </h3>
              <p className="text-sm leading-relaxed text-(--text-body)">{s.text}</p>
              <div className="mt-auto rounded-[10px] border border-(--line-1) bg-(--panel) px-3 py-2.5 text-[13px] leading-normal text-(--text-soft)">
                {s.sample}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
