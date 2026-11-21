/**
 * @module web/app/docs/[slug]/page
 * @description One statically generated page per `docs/*.md` file other than
 * the overview (which is `/docs`): the rendered article with its outline (see
 * `DocArticle`), and metadata taken from the file's title and first paragraph.
 *
 * @important `dynamicParams = false`: a slug that was not a file at build time
 *            is a 404, never rendered on demand.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocArticle } from "../../../components/docs/DocArticle";
import { listDocSlugs, readDoc } from "../../../lib/docs";

export const dynamicParams = false;

type Params = { slug: string };

/** One entry per doc file, read at build time. */
export function generateStaticParams(): Params[] {
  return listDocSlugs().map((slug) => ({ slug }));
}

/** Title from the first `# Heading`, description from the first paragraph. */
export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const doc = readDoc((await params).slug);
  if (!doc) return {};
  return {
    title: `${doc.title} - Nimbus Docs`,
    description: doc.summary || undefined,
  };
}

/** Renders one doc. */
export default async function DocPage({ params }: { params: Promise<Params> }) {
  const doc = readDoc((await params).slug);
  if (!doc) notFound();

  return <DocArticle doc={doc} />;
}
