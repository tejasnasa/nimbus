/**
 * @module web/components/docs/DocArticle
 * @description One rendered doc: a breadcrumb, the article itself, links to the
 * previous and next page in reading order beneath it, and, on wide screens, the
 * "On this page" outline of its `h2` headings with the section being read
 * highlighted.
 * Shared by the overview at `/docs` and every `/docs/<slug>` page.
 */
import Link from "next/link";
import {
  INDEX_SLUG,
  docHref,
  getAdjacentDocs,
  listDocSections,
  type Doc,
} from "../../lib/docs";
import { DocsMarkdown } from "./DocsMarkdown";
import { DocsOutline } from "./DocsOutline";

const PAGER_LINK =
  "flex flex-[1_1_220px] flex-col gap-1 rounded-xl border border-(--line-2) px-4.5 py-4 transition-colors hover:bg-(--surface-1) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--violet)";

/**
 * Renders a doc.
 *
 * @param props.doc - The doc, as `readDoc` returns it.
 */
export function DocArticle({ doc }: { doc: Doc }) {
  const { previous, next } = getAdjacentDocs(doc.slug);
  const section =
    doc.slug === INDEX_SLUG
      ? undefined
      : listDocSections().find((s) => s.docs.some((d) => d.slug === doc.slug));
  const sectionTitle = section?.dir ? section.title : undefined;

  return (
    <div className="flex gap-12">
      <div className="min-w-0 max-w-190 flex-1 pt-6 pb-24 lg:pt-11">
        <nav
          aria-label="Breadcrumb"
          className="mb-5.5 flex flex-wrap items-center gap-2 text-[13px] text-(--muted-foreground)"
        >
          <Link href="/docs" className="transition-colors hover:text-(--foreground)">
            Docs
          </Link>
          {sectionTitle && (
            <>
              <span aria-hidden="true">/</span>
              <span>{sectionTitle}</span>
            </>
          )}
          {doc.slug !== INDEX_SLUG && (
            <>
              <span aria-hidden="true">/</span>
              <span aria-current="page" className="text-(--text-strong)">
                {doc.title}
              </span>
            </>
          )}
        </nav>
        <article className="docs-prose">
          <DocsMarkdown content={doc.content} slug={doc.slug} />
        </article>
        {(previous || next) && (
          <nav
            aria-label="Previous and next page"
            className="mt-14 flex flex-wrap justify-between gap-3.5 border-t border-(--line-1) pt-7"
          >
            {previous ? (
              <Link href={docHref(previous.slug)} className={PAGER_LINK}>
                <span className="text-xs text-(--muted-foreground)">Previous</span>
                <span className="font-display text-[17px] font-semibold">
                  <span aria-hidden="true">← </span>
                  {previous.title}
                </span>
              </Link>
            ) : (
              <span className="flex-[1_1_220px]" />
            )}
            {next && (
              <Link href={docHref(next.slug)} className={`${PAGER_LINK} text-right`}>
                <span className="text-xs text-(--muted-foreground)">Next</span>
                <span className="font-display text-[17px] font-semibold">
                  {next.title}
                  <span aria-hidden="true"> →</span>
                </span>
              </Link>
            )}
          </nav>
        )}
      </div>
      {doc.headings.length > 0 && (
        <aside className="sticky top-21 hidden h-fit w-55 shrink-0 py-11 xl:block">
          <p className="pb-2.5 font-mono text-[11px] tracking-[0.12em] text-(--muted-foreground) uppercase">
            On this page
          </p>
          <DocsOutline headings={doc.headings} />
        </aside>
      )}
    </div>
  );
}
