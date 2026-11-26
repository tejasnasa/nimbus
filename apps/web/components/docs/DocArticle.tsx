/**
 * @module web/components/docs/DocArticle
 * @description One rendered doc: the article itself, links to the previous and
 * next page in reading order beneath it, and, on wide screens, the "On this
 * page" outline of its `h2` headings with the section being read highlighted.
 * Shared by the overview at `/docs` and every `/docs/<slug>` page.
 */
import Link from "next/link";
import { docHref, getAdjacentDocs, type Doc } from "../../lib/docs";
import { DocsMarkdown } from "./DocsMarkdown";
import { DocsOutline } from "./DocsOutline";

/**
 * Renders a doc.
 *
 * @param props.doc - The doc, as `readDoc` returns it.
 */
export function DocArticle({ doc }: { doc: Doc }) {
  const { previous, next } = getAdjacentDocs(doc.slug);

  return (
    <div className="flex gap-10">
      <div className="min-w-0 max-w-3xl flex-1">
        <article className="docs-prose">
          <DocsMarkdown content={doc.content} slug={doc.slug} />
        </article>
        {(previous || next) && (
          <nav
            aria-label="Previous and next page"
            className="mt-12 grid gap-3 border-t border-(--border) pt-6 sm:grid-cols-2"
          >
            {previous ? (
              <Link
                href={docHref(previous.slug)}
                className="rounded-lg border border-(--border) px-4 py-3 transition-colors hover:bg-(--accent)/60"
              >
                <span className="block text-xs text-(--muted-foreground)">
                  Previous
                </span>
                <span className="text-sm">{previous.title}</span>
              </Link>
            ) : (
              <span />
            )}
            {next && (
              <Link
                href={docHref(next.slug)}
                className="rounded-lg border border-(--border) px-4 py-3 text-right transition-colors hover:bg-(--accent)/60"
              >
                <span className="block text-xs text-(--muted-foreground)">
                  Next
                </span>
                <span className="text-sm">{next.title}</span>
              </Link>
            )}
          </nav>
        )}
      </div>
      {doc.headings.length > 0 && (
        <aside className="sticky top-24 hidden h-fit w-52 shrink-0 xl:block">
          <p className="mb-2 text-xs uppercase tracking-wider text-(--muted-foreground)">
            On this page
          </p>
          <DocsOutline headings={doc.headings} />
        </aside>
      )}
    </div>
  );
}
