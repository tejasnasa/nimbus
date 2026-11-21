"use client";

/**
 * @module web/components/docs/DocsNav
 * @description Docs sidebar: the overview, then every doc. A fixed vertical list from the `lg` breakpoint up;
 * below it, a collapsible "Documentation" menu above the article. The active
 * page is read from the pathname, which is why this is the one client component
 * in the layout.
 *
 * @important The mobile menu is keyed on the pathname so it remounts closed
 *            after every navigation, rather than tracking open state by hand.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { DocMeta } from "../../lib/docs";

/**
 * Renders the sidebar.
 *
 * @param props.docs - Every doc except the overview, in sidebar order.
 */
export function DocsNav({ docs }: { docs: Pick<DocMeta, "slug" | "title">[] }) {
  const pathname = usePathname();

  const entries = [
    { href: "/docs", title: "Overview" },
    ...docs.map((doc) => ({ href: `/docs/${doc.slug}`, title: doc.title })),
  ];

  const links = (
    <ul className="flex flex-col gap-0.5">
      {entries.map(({ href, title }) => {
        const active = pathname === href;
        return (
          <li key={href}>
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              className={`block rounded-lg px-3 py-1.5 text-sm transition-colors ${
                active
                  ? "bg-(--accent) text-(--foreground)"
                  : "text-(--muted-foreground) hover:bg-(--accent)/60 hover:text-(--foreground)"
              }`}
            >
              {title}
            </Link>
          </li>
        );
      })}
    </ul>
  );

  return (
    <nav aria-label="Documentation">
      <details key={pathname} className="docs-menu lg:hidden">
        <summary className="cursor-pointer rounded-lg border border-(--border) bg-(--card)/40 px-3 py-2 text-sm">
          Documentation
        </summary>
        <div className="mt-2 rounded-lg border border-(--border) bg-(--card) p-2">
          {links}
        </div>
      </details>
      <div className="hidden lg:block">
        <p className="mb-2 px-3 text-xs uppercase tracking-wider text-(--muted-foreground)">
          Documentation
        </p>
        {links}
      </div>
    </nav>
  );
}
