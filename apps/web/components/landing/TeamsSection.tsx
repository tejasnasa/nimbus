/**
 * @module web/components/landing/TeamsSection
 * @description The "Built for teams" section: three cards on roles, access that
 * ends when membership does, and the open-source licence.
 */
import type { ReactNode } from "react";
import { Eyebrow, SectionTitle } from "./parts";

/** Stroke icon shared by the three cards. */
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--violet)"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const CARDS: ReadonlyArray<{ title: string; text: string; icon: ReactNode }> = [
  {
    title: "Clear roles",
    text: "One owner, admins who manage people and keys, and members who just get to work. Invite anyone with a code you can rotate.",
    icon: (
      <Icon>
        <circle cx="9" cy="8" r="3.5" />
        <path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5" />
        <path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.8c1.7.8 2.7 2.6 3 5.2" />
      </Icon>
    ),
  },
  {
    title: "Access that ends on time",
    text: "Remove someone and they lose live access straight away, not at their next login. Every realtime action is checked against membership.",
    icon: (
      <Icon>
        <rect x="4" y="10.5" width="16" height="10" rx="2.5" />
        <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
      </Icon>
    ),
  },
  {
    title: "Open source",
    text: "MIT licensed and on GitHub. Read every line, file an issue, or send a pull request.",
    icon: (
      <Icon>
        <path d="M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 4l-3 16" />
      </Icon>
    ),
  },
];

/** Renders the "built for teams" section. */
export default function TeamsSection() {
  return (
    <section className="flex flex-col gap-10 pt-20 pb-10 sm:pt-25">
      <div className="flex max-w-190 flex-col gap-4">
        <Eyebrow>Built for teams</Eyebrow>
        <SectionTitle first="The boring parts," accent="done properly." />
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-5">
        {CARDS.map((c) => (
          <div
            key={c.title}
            className="flex flex-col gap-3 rounded-[18px] border border-(--line-2) bg-(--surface-1) p-6.5"
          >
            {c.icon}
            <h3 className="font-display text-xl font-semibold">{c.title}</h3>
            <p className="text-sm leading-relaxed text-(--text-body)">{c.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
