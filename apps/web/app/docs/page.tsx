/**
 * @module web/app/docs/page
 * @description `/docs`: the overview, rendered from `docs/README.md`, the same
 * file GitHub shows when the folder is opened. Statically generated.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocArticle } from "../../components/docs/DocArticle";
import { INDEX_SLUG, readDoc } from "../../lib/docs";

/** Title and description from the overview's heading and first paragraph. */
export function generateMetadata(): Metadata {
  const doc = readDoc(INDEX_SLUG);
  return {
    title: `${doc?.title ?? "Documentation"} - Nimbus`,
    description:
      doc?.summary ||
      "How Nimbus is built: architecture, realtime sync, the AI pipeline, the REST API, data model, testing and operations.",
  };
}

/** Renders the overview. */
export default function DocsIndexPage() {
  const doc = readDoc(INDEX_SLUG);
  if (!doc) notFound();
  return <DocArticle doc={doc} />;
}
