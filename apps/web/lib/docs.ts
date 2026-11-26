/**
 * @module web/lib/docs
 * @description Server-side access to the repository's Markdown docs. The
 * `docs/` tree at the repo root is the single source of truth: this module
 * walks it (pages live in topic folders such as `docs/realtime/`), reads one
 * page, pulls out its title, summary and headings, fixes the sidebar order and
 * grouping, and rewrites the links inside a page so they work on the site.
 *
 * A page's slug is its path under `docs/` without `.md`, using `/` between
 * folders: `docs/realtime/canvas-sync.md` is `realtime/canvas-sync`, served at
 * `/docs/realtime/canvas-sync`.
 *
 * @important Reads the filesystem, so it belongs to server components and
 *            `generateStaticParams` only; never import it from a `"use client"`
 *            file. The docs are read at build time, so a doc edit needs a
 *            rebuild (the web `build` task lists `docs/**` as an input for that
 *            reason).
 * @important The docs must keep rendering on GitHub, so nothing here asks the
 *            files for site-specific syntax. Relative `*.md` links are the
 *            GitHub-native form; they are resolved from the linking page's own
 *            folder and mapped to `/docs/<slug>` at render time.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import GithubSlugger from "github-slugger";

/** The repository on GitHub; repo files outside `docs/` link here. */
export const GITHUB_REPO_URL = "https://github.com/tejasnasa/nimbus";
/** The branch repo-file links point at. */
export const GITHUB_BRANCH = "main";

/**
 * The overview, `docs/README.md`. GitHub shows it when the folder is opened, and
 * the site serves it at `/docs` rather than as one more entry in the list.
 */
export const INDEX_SLUG = "README";

/** A sidebar group: one folder under `docs/` and the order of its pages. */
export type DocSectionSpec = {
  /** Folder name under `docs/`. */
  dir: string;
  /** Heading shown above the group in the sidebar. */
  title: string;
  /** Page file names (without `.md`) in reading order. */
  docs: readonly string[];
};

/**
 * Sidebar groups and their reading order. A page in a listed folder but not in
 * its list follows that folder's listed pages alphabetically; a folder that is
 * not listed at all follows every listed one, titled from its name.
 */
export const DOC_SECTIONS: readonly DocSectionSpec[] = [
  {
    dir: "getting-started",
    title: "Getting started",
    docs: ["local-setup", "monorepo"],
  },
  {
    dir: "architecture",
    title: "Architecture",
    docs: ["overview", "auth", "security"],
  },
  {
    dir: "realtime",
    title: "Realtime collaboration",
    docs: ["overview", "markdown-sync", "canvas-sync", "presence-and-chat"],
  },
  {
    dir: "meetings",
    title: "Meetings and voice",
    docs: [
      "voice-and-livekit",
      "voice-agent",
      "transcripts-and-notes",
      "assistant-and-tools",
    ],
  },
  {
    dir: "ai",
    title: "AI",
    docs: [
      "providers-and-byok",
      "quotas-and-free-tier",
      "nimbusbot",
      "document-generation",
      "memory-and-search",
    ],
  },
  { dir: "frontend", title: "Frontend", docs: ["overview"] },
  { dir: "testing", title: "Testing", docs: ["overview", "end-to-end"] },
  {
    dir: "operations",
    title: "Operations",
    docs: ["deployment", "runbook"],
  },
  {
    dir: "guides",
    title: "How-to guides",
    docs: [
      "add-an-endpoint",
      "add-a-socket-event",
      "add-an-assistant-tool",
      "change-the-schema",
    ],
  },
  {
    dir: "reference",
    title: "Reference",
    docs: ["rest-api", "socket-events", "data-model", "environment"],
  },
];

/** Every listed page's slug, in sidebar order. */
export const DOC_ORDER: readonly string[] = DOC_SECTIONS.flatMap((section) =>
  section.docs.map((doc) => `${section.dir}/${doc}`),
);

/**
 * Pages of the earlier, flat docs tree and where their content lives now, so
 * links to the old URLs keep working.
 */
export const LEGACY_SLUGS: Readonly<Record<string, string>> = {
  ai: "ai/providers-and-byok",
  api: "reference/rest-api",
  data: "reference/data-model",
  "document-generation": "ai/document-generation",
  "document-sync": "realtime/markdown-sync",
};

/** What the index and sidebar need to know about a doc. */
export type DocMeta = {
  slug: string;
  title: string;
  /** First paragraph after the title, as plain text; empty when there is none. */
  summary: string;
};

/** A doc with its Markdown body and the `h2` headings for the page outline. */
export type Doc = DocMeta & {
  content: string;
  headings: DocHeading[];
};

/** A heading as the on-page outline lists it. */
export type DocHeading = { id: string; text: string };

/** One sidebar group with its pages resolved. */
export type DocSection = {
  /** Folder name; `""` for pages directly under `docs/`. */
  dir: string;
  title: string;
  docs: Pick<DocMeta, "slug" | "title">[];
};

/** A link or image target after rewriting. */
export type ResolvedTarget = {
  href: string;
  /** True when the target leaves the site (opens in a new tab). */
  external: boolean;
};

const FENCE = /^\s{0,3}(```+|~~~+)/;
const SEGMENT = /^[a-z0-9][a-z0-9-]*$/i;
/** Deepest folder nesting a slug may have; keeps the walk and the URLs bounded. */
const MAX_DEPTH = 3;

/**
 * Finds the docs directory. `process.cwd()` is `apps/web` under `next dev`,
 * `next build` and the workspace test script, but the module's own location is
 * the more reliable anchor, so both are tried.
 *
 * @returns The absolute path of the repository's `docs` folder.
 * @throws When no candidate exists, naming every place that was tried.
 */
export function resolveDocsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "../../../docs"),
    path.resolve(process.cwd(), "../../docs"),
    path.resolve(process.cwd(), "docs"),
  ];
  const found = candidates.find(
    (dir) => existsSync(dir) && statSync(dir).isDirectory(),
  );
  if (!found) {
    throw new Error(
      `Docs directory not found. Looked in:\n${candidates.map((c) => `  - ${c}`).join("\n")}`,
    );
  }
  return found;
}

/** Normalises line endings so CRLF checkouts parse the same as LF ones. */
function lines(markdown: string): string[] {
  return markdown.replace(/\r\n?/g, "\n").split("\n");
}

/** Reduces inline Markdown (links, code, emphasis, images) to plain text. */
export function stripInlineMarkdown(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(\*|_)(.+?)\1/g, "$2")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Reads the first `# Heading` outside code fences.
 *
 * @param markdown - A doc's source.
 * @returns The heading as plain text, or `null` when there is none.
 */
export function extractTitle(markdown: string): string | null {
  let inFence = false;
  for (const line of lines(markdown)) {
    if (FENCE.test(line)) inFence = !inFence;
    if (inFence) continue;
    const match = /^#\s+(.+?)\s*#*\s*$/.exec(line);
    if (match) return stripInlineMarkdown(match[1] ?? "");
  }
  return null;
}

/**
 * Reads the first paragraph after the title. Headings, lists, tables, quotes,
 * fences and HTML are not paragraphs, so a doc that opens with one of them has
 * no summary.
 *
 * @param markdown - A doc's source.
 * @returns The paragraph as one line of plain text; `""` when there is none.
 */
export function extractSummary(markdown: string): string {
  const all = lines(markdown);
  let i = all.findIndex((line) => /^#\s+\S/.test(line));
  if (i === -1) return "";
  i += 1;
  while (i < all.length && (all[i] ?? "").trim() === "") i += 1;
  const first = all[i] ?? "";
  if (/^(#|>|[-*+]\s|\d+[.)]\s|\||<|\s{0,3}(```|~~~))/.test(first)) return "";
  const paragraph: string[] = [];
  for (; i < all.length; i += 1) {
    const line = all[i] ?? "";
    if (line.trim() === "") break;
    paragraph.push(line);
  }
  return stripInlineMarkdown(paragraph.join(" "));
}

/**
 * Lists the `h2` headings with the ids `rehype-slug` gives them: both use
 * `github-slugger` over every heading in document order, so duplicates get the
 * same `-1`, `-2` suffixes.
 *
 * @param markdown - A doc's source.
 * @returns The `h2` headings in order.
 */
export function extractHeadings(markdown: string): DocHeading[] {
  const slugger = new GithubSlugger();
  const headings: DocHeading[] = [];
  let inFence = false;
  for (const line of lines(markdown)) {
    if (FENCE.test(line)) inFence = !inFence;
    if (inFence) continue;
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) continue;
    const text = stripInlineMarkdown(match[2] ?? "");
    const id = slugger.slug(text);
    if (match[1]?.length === 2) headings.push({ id, text });
  }
  return headings;
}

/** The folder part of a slug: `"realtime"` for `realtime/overview`, `""` at the top. */
function dirOf(slug: string): string {
  const at = slug.lastIndexOf("/");
  return at === -1 ? "" : slug.slice(0, at);
}

/** `"how-to-guides"` → `"How to guides"`, for folders `DOC_SECTIONS` does not name. */
function titleFromDir(dir: string): string {
  const words = dir.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Sorts slugs into sidebar order: pages directly under `docs/` first, then each
 * listed folder in `DOC_SECTIONS` order with its listed pages first and any
 * others alphabetically, then unlisted folders alphabetically, so a new doc
 * never disappears.
 *
 * @param slugs - Doc slugs in any order.
 * @returns A new array in sidebar order.
 */
export function sortSlugs(slugs: readonly string[]): string[] {
  const sectionRank = (dir: string) => {
    if (dir === "") return -1;
    const index = DOC_SECTIONS.findIndex((section) => section.dir === dir);
    return index === -1 ? DOC_SECTIONS.length : index;
  };
  const pageRank = (slug: string) => {
    const index = DOC_ORDER.indexOf(slug);
    return index === -1 ? DOC_ORDER.length : index;
  };
  return [...slugs].sort((a, b) => {
    const dirA = dirOf(a);
    const dirB = dirOf(b);
    return (
      sectionRank(dirA) - sectionRank(dirB) ||
      dirA.localeCompare(dirB) ||
      pageRank(a) - pageRank(b) ||
      a.localeCompare(b)
    );
  });
}

/** Collects the slugs of every `.md` file below `dir`, to `MAX_DEPTH` folders. */
function walk(dir: string, prefix: string, depth: number): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (depth < MAX_DEPTH && SEGMENT.test(entry.name)) {
        found.push(
          ...walk(
            path.join(dir, entry.name),
            `${prefix}${entry.name}/`,
            depth + 1,
          ),
        );
      }
    } else if (entry.name.endsWith(".md")) {
      const name = entry.name.slice(0, -3);
      if (SEGMENT.test(name)) found.push(`${prefix}${name}`);
    }
  }
  return found;
}

/** Slugs of every doc under `docs/` except the overview, in sidebar order. */
export function listDocSlugs(): string[] {
  const slugs = walk(resolveDocsDir(), "", 0).filter(
    (slug) => slug !== INDEX_SLUG,
  );
  return sortSlugs(slugs);
}

/**
 * Checks that a slug is a plain relative page path: one to `MAX_DEPTH + 1`
 * segments of letters, digits and dashes. Anything else is never joined into a
 * filesystem path.
 */
export function isValidSlug(slug: string): boolean {
  const segments = slug.split("/");
  return (
    segments.length <= MAX_DEPTH + 1 &&
    segments.every((segment) => SEGMENT.test(segment))
  );
}

/**
 * Reads one doc.
 *
 * @param slug - Path under `docs/` without `.md`, `/`-separated.
 * @returns The doc, or `null` when no such file exists or the slug is not a
 *          plain page path.
 */
export function readDoc(slug: string): Doc | null {
  if (!isValidSlug(slug)) return null;
  const file = path.join(resolveDocsDir(), ...slug.split("/")) + ".md";
  if (!existsSync(file) || !statSync(file).isFile()) return null;
  const content = readFileSync(file, "utf8").replace(/\r\n?/g, "\n");
  return {
    slug,
    title: extractTitle(content) ?? slug,
    summary: extractSummary(content),
    content,
    headings: extractHeadings(content),
  };
}

/** Title and summary of every doc except the overview, in sidebar order. */
export function listDocs(): DocMeta[] {
  return listDocSlugs().map((slug) => {
    const { title, summary } = readDoc(slug)!;
    return { slug, title, summary };
  });
}

/**
 * Groups every doc except the overview into sidebar sections, in sidebar order.
 *
 * @returns One entry per folder that holds at least one page.
 */
export function listDocSections(): DocSection[] {
  const sections: DocSection[] = [];
  for (const { slug, title } of listDocs()) {
    const dir = dirOf(slug);
    let section = sections.at(-1);
    if (!section || section.dir !== dir) {
      section = {
        dir,
        title:
          DOC_SECTIONS.find((spec) => spec.dir === dir)?.title ??
          titleFromDir(dir),
        docs: [],
      };
      sections.push(section);
    }
    section.docs.push({ slug, title });
  }
  return sections;
}

/**
 * The pages before and after one page in reading order, the overview first.
 *
 * @param slug - The current page.
 * @returns Its neighbours; either is `null` at an end of the order.
 */
export function getAdjacentDocs(slug: string): {
  previous: Pick<DocMeta, "slug" | "title"> | null;
  next: Pick<DocMeta, "slug" | "title"> | null;
} {
  const order = [INDEX_SLUG, ...listDocSlugs()];
  const index = order.indexOf(slug);
  const meta = (at: number) => {
    const neighbour = order[at];
    if (index === -1 || neighbour === undefined) return null;
    return { slug: neighbour, title: readDoc(neighbour)?.title ?? neighbour };
  };
  return { previous: meta(index - 1), next: meta(index + 1) };
}

/**
 * Where a URL that is not a page should go instead: a folder goes to its first
 * page, and a page of the earlier flat tree goes to where its content lives
 * now.
 *
 * @param slug - The requested path under `/docs/`.
 * @returns The slug to redirect to, or `null` when there is none.
 */
export function resolveDocRedirect(slug: string): string | null {
  if (readDoc(slug)) return null;
  const legacy = LEGACY_SLUGS[slug];
  if (legacy && readDoc(legacy)) return legacy;
  const first = listDocSlugs().find((page) => dirOf(page) === slug);
  return first ?? null;
}

/**
 * Every folder and legacy slug that `resolveDocRedirect` sends somewhere, so
 * they can be generated as static routes alongside the pages.
 */
export function listRedirectSlugs(): string[] {
  const pages = listDocSlugs();
  const dirs = new Set(pages.map(dirOf).filter((dir) => dir !== ""));
  const candidates = [...dirs, ...Object.keys(LEGACY_SLUGS)];
  return [...new Set(candidates)].filter(
    (slug) => !pages.includes(slug) && resolveDocRedirect(slug) !== null,
  );
}

/** The site URL of a page: `/docs` for the overview, `/docs/<slug>` otherwise. */
export function docHref(slug: string): string {
  return slug === INDEX_SLUG ? "/docs" : `/docs/${slug}`;
}

/**
 * Maps a link or image target found in a doc to where it lives on the site.
 * Relative links are resolved from the linking page's folder, as GitHub does:
 * another doc becomes `/docs/<slug>` (hash kept), the overview becomes `/docs`,
 * any other repo file becomes a GitHub URL, and absolute URLs and fragments are
 * left alone.
 *
 * @param target - The raw `href` or `src`.
 * @param kind - `"link"` points at GitHub's file view, `"image"` at the raw file.
 * @param from - Slug of the page the target appears in; the overview by default.
 * @returns The rewritten target and whether it leaves the site.
 */
export function resolveDocTarget(
  target: string,
  kind: "link" | "image" = "link",
  from: string = INDEX_SLUG,
): ResolvedTarget {
  if (!target || target.startsWith("#") || target.startsWith("/")) {
    return { href: target, external: false };
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//")) {
    return { href: target, external: true };
  }

  const hashAt = target.search(/[?#]/);
  const pathPart = hashAt === -1 ? target : target.slice(0, hashAt);
  const suffix = hashAt === -1 ? "" : target.slice(hashAt);
  const baseDir = path.posix.dirname(`docs/${from}.md`);
  const repoPath = path.posix.normalize(path.posix.join(baseDir, pathPart));

  if (repoPath.startsWith("..")) return { href: target, external: false };

  const doc = /^docs\/(.+)\.md$/.exec(repoPath);
  if (doc?.[1] && kind === "link" && isValidSlug(doc[1])) {
    return { href: `${docHref(doc[1])}${suffix}`, external: false };
  }

  const view = kind === "image" ? "raw" : "blob";
  return {
    href: `${GITHUB_REPO_URL}/${view}/${GITHUB_BRANCH}/${repoPath}${suffix}`,
    external: true,
  };
}
