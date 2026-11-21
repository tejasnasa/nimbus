/**
 * @module web/lib/docs
 * @description Server-side access to the repository's Markdown docs. The
 * `docs/*.md` files at the repo root are the single source of truth: this module
 * lists them, reads one, pulls out its title, summary and headings, fixes the
 * sidebar order, and rewrites the links inside them so they work on the site.
 *
 * @important Reads the filesystem, so it belongs to server components and
 *            `generateStaticParams` only; never import it from a `"use client"`
 *            file. The docs are read at build time, so a doc edit needs a
 *            rebuild (the web `build` task lists `docs/**` as an input for that
 *            reason).
 * @important The docs must keep rendering on GitHub, so nothing here asks the
 *            files for site-specific syntax. Relative `*.md` links are the
 *            GitHub-native form and are mapped to `/docs/<slug>` at render time.
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

/** Sidebar order. Any doc not listed here follows, alphabetically. */
export const DOC_ORDER = [
  "getting-started",
  "architecture",
  "realtime",
  "document-sync",
  "document-generation",
  "ai",
  "api",
  "data",
  "frontend",
  "testing",
  "operations",
] as const;

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

/** A link or image target after rewriting. */
export type ResolvedTarget = {
  href: string;
  /** True when the target leaves the site (opens in a new tab). */
  external: boolean;
};

const FENCE = /^\s{0,3}(```+|~~~+)/;

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

/**
 * Sorts slugs into sidebar order: the fixed list first, anything else after it
 * alphabetically, so a new doc never disappears.
 *
 * @param slugs - Doc slugs in any order.
 * @returns A new array in sidebar order.
 */
export function sortSlugs(slugs: readonly string[]): string[] {
  const rank = (slug: string) => {
    const index = (DOC_ORDER as readonly string[]).indexOf(slug);
    return index === -1 ? DOC_ORDER.length : index;
  };
  return [...slugs].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** Slugs of every `docs/*.md` file except the overview, in sidebar order. */
export function listDocSlugs(): string[] {
  const dir = resolveDocsDir();
  const slugs = readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => name.slice(0, -3))
    .filter((slug) => slug !== INDEX_SLUG);
  return sortSlugs(slugs);
}

/**
 * Reads one doc.
 *
 * @param slug - File name without `.md`.
 * @returns The doc, or `null` when no such file exists (a slug is never joined
 *          into a path unless it is a plain file name).
 */
export function readDoc(slug: string): Doc | null {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(slug)) return null;
  const file = path.join(resolveDocsDir(), `${slug}.md`);
  if (!existsSync(file)) return null;
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
 * Maps a link or image target found in a doc to where it lives on the site.
 * Relative links are resolved from `docs/`: another doc becomes `/docs/<slug>`
 * (hash kept), the overview becomes `/docs`, any other repo file becomes a GitHub URL, and absolute URLs and
 * fragments are left alone.
 *
 * @param target - The raw `href` or `src`.
 * @param kind - `"link"` points at GitHub's file view, `"image"` at the raw file.
 * @returns The rewritten target and whether it leaves the site.
 */
export function resolveDocTarget(
  target: string,
  kind: "link" | "image" = "link",
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
  const repoPath = path.posix.normalize(path.posix.join("docs", pathPart));

  if (repoPath.startsWith("..")) return { href: target, external: false };

  const doc = /^docs\/([^/]+)\.md$/.exec(repoPath);
  if (doc?.[1] === INDEX_SLUG && kind === "link") {
    return { href: `/docs${suffix}`, external: false };
  }
  if (doc && kind === "link") {
    return { href: `/docs/${doc[1]}${suffix}`, external: false };
  }

  const view = kind === "image" ? "raw" : "blob";
  return {
    href: `${GITHUB_REPO_URL}/${view}/${GITHUB_BRANCH}/${repoPath}${suffix}`,
    external: true,
  };
}
