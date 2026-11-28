/**
 * @module web/components/landing/ActivityTicker
 * @description The slow marquee of sample workspace activity under the hero.
 * Pure CSS: the list is rendered twice and the track slides by half its width,
 * so the loop is seamless.
 *
 * @important Decorative sample copy, so the second copy is `aria-hidden` and
 *            the region is labelled for assistive tech only once. Motion stops
 *            under `prefers-reduced-motion` (the stylesheet handles it).
 */
import { PERSONA_COLOR, type Persona } from "./personas";

const ITEMS: ReadonlyArray<{ who: Persona; verb: string; what: string }> = [
  { who: "Priya", verb: "is editing", what: "Launch plan" },
  { who: "Nimbus", verb: "wrote notes for", what: "Auth sync" },
  { who: "Marco", verb: "moved 3 shapes on", what: "Roadmap board" },
  { who: "Aiko", verb: "joined the call in", what: "#design" },
  { who: "Nimbus", verb: "translated captions", what: "JA → EN" },
  { who: "Sam", verb: "assigned", what: "Update pricing copy" },
  { who: "Priya", verb: "asked Nimbus", what: "“What did we ship last sprint?”" },
  { who: "Nimbus", verb: "turned a sketch into", what: "Onboarding flow" },
];

/** Renders the activity marquee. */
export default function ActivityTicker() {
  return (
    <section
      aria-label="Workspace activity"
      className="overflow-hidden border-y border-(--line-1) bg-(--panel) py-4.5 font-sans"
    >
      <div className="lp-marquee flex w-max gap-3.5">
        {[0, 1].map((copy) =>
          ITEMS.map((t, i) => (
            <span
              key={`${copy}-${i}`}
              aria-hidden={copy === 1 ? true : undefined}
              className="inline-flex shrink-0 items-center gap-2.5 rounded-full border border-[#241f29] bg-(--surface-1) px-3.5 py-2 text-[13px] whitespace-nowrap text-(--text-soft)"
            >
              <span
                className="inline-flex size-5.5 items-center justify-center rounded-[7px] bg-[#1c1821] font-display text-[11px] font-bold"
                style={{
                  color: PERSONA_COLOR[t.who],
                  boxShadow: `0 0 0 1px ${PERSONA_COLOR[t.who]}`,
                }}
              >
                {t.who.charAt(0)}
              </span>
              <span className="font-medium text-(--foreground)">{t.who}</span>
              <span className="text-(--muted-foreground)">{t.verb}</span>
              <span>{t.what}</span>
            </span>
          )),
        )}
      </div>
    </section>
  );
}
