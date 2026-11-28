/**
 * @module web/app/docs/layout
 * @description Shell for every `/docs` page: the sticky docs header from the
 * shared site navbar, the sidebar grouped by docs folder (a dropdown on
 * phones), and the content column. Public; `proxy.ts` only guards `/home`,
 * `/workspace` and `/settings`.
 */
import SiteNavbar from "../../components/SiteNavbar";
import { DocsNav } from "../../components/docs/DocsNav";
import { listDocSections } from "../../lib/docs";
import "./docs.css";

/** Wraps docs pages with the docs header and the docs sidebar. */
export default function DocsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const sections = listDocSections();

  return (
    <div className="min-h-dvh bg-(--background) font-sans text-(--foreground)">
      <SiteNavbar variant="docs" />
      <div className="mx-auto flex max-w-360 flex-col gap-4 px-5 sm:px-10 lg:flex-row lg:items-start lg:gap-12">
        <aside className="pt-6 lg:sticky lg:top-21 lg:w-60 lg:shrink-0 lg:py-9">
          <DocsNav sections={sections} />
        </aside>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
