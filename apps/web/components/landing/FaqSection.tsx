/**
 * @module web/components/landing/FaqSection
 * @description The FAQ: a heading column with a link to the contact page and an
 * accordion of questions, one open at a time (the first by default).
 *
 * @important Each toggle is a real button with `aria-expanded` and
 *            `aria-controls`; the answer panel is only mounted while open.
 */
"use client";
import Link from "next/link";
import { useState } from "react";
import { Eyebrow, SectionTitle } from "./parts";

const FAQS = [
  {
    q: "Is Nimbus free to use?",
    a: "Yes, you can start for free. Docs, whiteboards, chat and calls work out of the box, and every new account gets ten free minutes of the meeting assistant. After that, a workspace admin adds a model key and you pay your provider directly.",
  },
  {
    q: "Do I need an AI key to use calls?",
    a: "No. Calls work without any key. The meeting assistant is optional, so a workspace without a voice key still gets plain calls and every other feature.",
  },
  {
    q: "Which AI providers can I use?",
    a: "OpenAI, Groq, DeepSeek and OpenRouter. Admins add keys per workspace and choose which model each feature uses.",
  },
  {
    q: "Does Nimbus record our meetings?",
    a: "No audio or video is recorded. Nimbus turns what is said into text, which becomes your captions, notes and the record it answers questions from.",
  },
  {
    q: "Which languages do captions support?",
    a: "Each viewer chooses the language their captions are translated into, so a team can speak in one language and read in several.",
  },
  {
    q: "Can Nimbus edit my existing whiteboards?",
    a: "Not yet. It creates new diagrams, from a chat prompt, a photo of a sketch, or a meeting.",
  },
  {
    q: "Is Nimbus open source?",
    a: "Yes. Nimbus is MIT licensed, and the code is on GitHub.",
  },
];

/** Renders the FAQ section. */
export default function FaqSection() {
  const [openIndex, setOpenIndex] = useState(0);

  return (
    <section id="faq" className="flex scroll-mt-4 flex-wrap gap-14 pt-20 pb-10 sm:pt-25">
      <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-4">
        <Eyebrow>FAQ</Eyebrow>
        <SectionTitle first="Questions," accent="answered." />
        <p className="text-[15px] leading-relaxed text-(--text-body)">
          Something else on your mind?{" "}
          <Link
            href="/contact"
            className="text-(--violet-soft) underline-offset-4 hover:text-(--violet-pale) hover:underline"
          >
            Get in touch
          </Link>
          .
        </p>
      </div>
      <div className="flex min-w-0 flex-[999_1_560px] flex-col">
        {FAQS.map((f, i) => {
          const open = openIndex === i;
          return (
            <div key={f.q} className="border-b border-(--line-1)">
              <h3>
                <button
                  type="button"
                  id={`faq-q-${i}`}
                  aria-expanded={open}
                  aria-controls={`faq-a-${i}`}
                  onClick={() => setOpenIndex(open ? -1 : i)}
                  className="flex min-h-16 w-full cursor-pointer items-center justify-between gap-4 py-4.5 text-left font-display text-lg font-medium text-(--foreground) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--violet)"
                >
                  <span>{f.q}</span>
                  <span
                    aria-hidden="true"
                    className={`flex size-7 shrink-0 items-center justify-center rounded-lg text-xl leading-none transition-[transform,background-color] duration-250 motion-reduce:transition-none ${
                      open
                        ? "rotate-45 bg-(--violet) text-(--ink)"
                        : "bg-(--surface-4) text-(--foreground)"
                    }`}
                  >
                    +
                  </span>
                </button>
              </h3>
              {open && (
                <p
                  id={`faq-a-${i}`}
                  role="region"
                  aria-labelledby={`faq-q-${i}`}
                  className="pr-10 pb-5.5 text-[15px] leading-[1.65] text-(--text-body)"
                >
                  {f.a}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
