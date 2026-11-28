"use client";

/**
 * @module web/components/docs/DocsNav
 * @description Docs sidebar: the overview, then every doc grouped under its
 * folder's heading. A fixed vertical list from the `lg` breakpoint up (scrolling
 * on its own when taller than the viewport); below it, a collapsible
 * "Documentation" menu above the article. The active page is read from the
 * pathname, which is why this is the one client component in the layout.
 *
 * @important The mobile menu is keyed on the pathname so it remounts closed
 *            after every navigation, rather than tracking open state by hand.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { DocSection } from "../../lib/docs";

/** One sidebar link, highlighted when it is the current page. */
function NavLink({
  href,
  title,
  active,
}: {
  href: string;
  title: string;
  active: boolean;
}) {
  return (
    <li>
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={`block rounded-[9px] px-3 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--violet) ${
          active
            ? "bg-(--surface-3) font-semibold text-(--foreground)"
            : "text-(--muted-foreground) hover:bg-(--surface-1) hover:text-(--foreground)"
        }`}
      >
        {title}
      </Link>
    </li>
  );
}

/**
 * Renders the sidebar.
 *
 * @param props.sections - Every doc except the overview, grouped by folder in
 *                         sidebar order.
 */
export function DocsNav({ sections }: { sections: DocSection[] }) {
  const pathname = usePathname();

  const links = (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-1">
        <NavLink href="/docs" title="Overview" active={pathname === "/docs"} />
      </ul>
      {sections.map((section) => (
        <div key={section.dir || "top"}>
          {section.dir && (
            <p className="mb-1 px-3 font-mono text-[11px] tracking-[0.12em] text-(--muted-foreground) uppercase">
              {section.title}
            </p>
          )}
          <ul className="flex flex-col gap-1">
            {section.docs.map((doc) => {
              const href = `/docs/${doc.slug}`;
              return (
                <NavLink
                  key={href}
                  href={href}
                  title={doc.title}
                  active={pathname === href}
                />
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );

  return (
    <nav aria-label="Documentation">
      <details key={pathname} className="docs-menu lg:hidden">
        <summary className="cursor-pointer rounded-[10px] border border-(--line-2) bg-(--surface-1) px-3 py-2.5 text-sm">
          Documentation
        </summary>
        <div className="mt-2 rounded-xl border border-(--line-2) bg-(--surface-1) p-2">
          {links}
        </div>
      </details>
      <div className="docs-sidebar hidden lg:block">
        <p className="px-3 pb-2.5 font-mono text-[11px] tracking-[0.12em] text-(--muted-foreground) uppercase">
          Documentation
        </p>
        {links}
      </div>
    </nav>
  );
}
