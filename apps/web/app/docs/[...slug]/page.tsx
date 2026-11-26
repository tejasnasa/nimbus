/**
 * @module web/app/docs/[...slug]/page
 * @description One statically generated page per doc under `docs/` other than
 * the overview (which is `/docs`), at the doc's path: `docs/realtime/canvas-sync.md`
 * is `/docs/realtime/canvas-sync`. Renders the article with its outline (see
 * `DocArticle`) and takes metadata from the file's title and first paragraph.
 * A docs folder, or a page of the earlier flat tree, redirects to the page
 * that now holds its content.
 *
 * @important `dynamicParams = false`: a path that was neither a doc nor a
 *            redirect at build time is a 404, never rendered on demand.
 */
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { DocArticle } from "../../../components/docs/DocArticle";
import {
  docHref,
  listDocSlugs,
  listRedirectSlugs,
  readDoc,
  resolveDocRedirect,
} from "../../../lib/docs";

export const dynamicParams = false;

type Params = { slug: string[] };

/** One entry per doc file and per redirecting path, read at build time. */
export function generateStaticParams(): Params[] {
  return [...listDocSlugs(), ...listRedirectSlugs()].map((slug) => ({
    slug: slug.split("/"),
  }));
}

/** Title from the first `# Heading`, description from the first paragraph. */
export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const doc = readDoc((await params).slug.join("/"));
  if (!doc) return {};
  return {
    title: `${doc.title} - Nimbus Docs`,
    description: doc.summary || undefined,
  };
}

/** Renders one doc, or redirects a folder or legacy path. */
export default async function DocPage({ params }: { params: Promise<Params> }) {
  const slug = (await params).slug.join("/");
  const doc = readDoc(slug);
  if (!doc) {
    const target = resolveDocRedirect(slug);
    if (target) permanentRedirect(docHref(target));
    notFound();
  }

  return <DocArticle doc={doc} />;
}
