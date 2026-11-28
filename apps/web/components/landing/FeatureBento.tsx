/**
 * @module web/components/landing/FeatureBento
 * @description The landing page's feature grid: six cards (docs, whiteboards,
 * chat, calls, search, export), each pairing a short description with a
 * decorative product preview. A 12-column grid from 1000px up, a single column
 * below.
 */
import { Eyebrow, SectionTitle } from "./parts";
import {
  BoardPreview,
  CallPreview,
  ChatPreview,
  DocPreview,
  ExportPreview,
  SearchPreview,
} from "./FeaturePreviews";
import type { ReactNode } from "react";

/** One grid card: label, title, description and its preview. */
function Card({
  span,
  label,
  labelColor = "text-(--violet)",
  title,
  large = false,
  children,
  preview,
}: {
  span: string;
  label: string;
  labelColor?: string;
  title: string;
  large?: boolean;
  children: ReactNode;
  preview: ReactNode;
}) {
  return (
    <article
      className={`${span} flex min-w-0 flex-col ${large ? "gap-5" : "gap-4.5"} rounded-2xl border border-(--line-2) bg-(--surface-1) p-6 sm:p-7`}
    >
      <div className="flex flex-col gap-2">
        <span className={`font-mono text-xs tracking-[0.12em] ${labelColor}`}>
          {label}
        </span>
        <h3
          className={`font-display ${large ? "text-[28px]" : "text-2xl"} font-semibold tracking-[-0.02em]`}
        >
          {title}
        </h3>
        <p
          className={`text-[15px] leading-[1.55] text-(--text-body) ${large ? "max-w-130" : ""}`}
        >
          {children}
        </p>
      </div>
      {preview}
    </article>
  );
}

/** Renders the features section. */
export default function FeatureBento() {
  return (
    <section id="features" className="flex scroll-mt-4 flex-col gap-14 pt-24 pb-10 sm:pt-30">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex min-w-0 flex-[1_1_560px] flex-col gap-4">
          <Eyebrow>Features</Eyebrow>
          <SectionTitle
            first="Everything your team makes,"
            accent="in one live room."
          />
        </div>
        <p className="flex-[0_1_400px] text-base leading-relaxed text-(--text-body)">
          Docs, whiteboards, chat and calls share one workspace, and every
          change reaches everyone the moment it happens.
        </p>
      </div>

      <div className="grid grid-cols-12 gap-4">
        <Card
          span="col-span-12 min-[1000px]:col-span-7 min-[1000px]:row-span-2"
          label="01 / DOCS"
          labelColor="text-(--lime)"
          title="Write together, live"
          large
          preview={<DocPreview />}
        >
          Rich-text docs where every keystroke merges without conflicts.
          Everyone&apos;s cursor shows in their own colour, with their name on
          it.
        </Card>
        <Card
          span="col-span-12 min-[1000px]:col-span-5"
          label="02 / WHITEBOARDS"
          title="Draw on the same board"
          preview={<BoardPreview />}
        >
          An endless canvas for flows and diagrams, with everyone&apos;s
          pointer moving live.
        </Card>
        <Card
          span="col-span-12 min-[1000px]:col-span-5"
          label="03 / CHAT"
          title="Ask @nimbus for a draft"
          preview={<ChatPreview />}
        >
          Mention Nimbus in chat and it reads the thread, then writes a doc or
          draws a diagram for everyone to edit.
        </Card>
        <Card
          span="col-span-12 min-[1000px]:col-span-4"
          label="04 / CALLS"
          title="A call one click away"
          preview={<CallPreview />}
        >
          Start a voice call from any tab and keep working while you talk.
        </Card>
        <Card
          span="col-span-12 min-[1000px]:col-span-4"
          label="05 / SEARCH"
          title="Find any doc"
          preview={<SearchPreview />}
        >
          Search every doc and board in the workspace, with the matching words
          highlighted.
        </Card>
        <Card
          span="col-span-12 min-[1000px]:col-span-4"
          label="06 / EXPORT"
          title="Take it with you"
          preview={<ExportPreview />}
        >
          Download a doc as Markdown or a board as a PNG, whenever you need it.
        </Card>
      </div>
    </section>
  );
}
