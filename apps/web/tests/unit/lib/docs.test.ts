import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import GithubSlugger from "github-slugger";
import { describe, expect, it } from "vitest";
import {
  DOC_ORDER,
  DOC_SECTIONS,
  GITHUB_BRANCH,
  GITHUB_REPO_URL,
  INDEX_SLUG,
  LEGACY_SLUGS,
  docHref,
  extractHeadings,
  extractSummary,
  extractTitle,
  getAdjacentDocs,
  isValidSlug,
  listDocSections,
  listDocSlugs,
  listDocs,
  listRedirectSlugs,
  readDoc,
  resolveDocRedirect,
  resolveDocTarget,
  resolveDocsDir,
  sortSlugs,
} from "../../../lib/docs";

const docsDir = resolveDocsDir();

/** Every `.md` file under `docs/` as a slug, found independently of the module. */
function findSlugs(dir: string, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      return findSlugs(path.join(dir, entry.name), `${prefix}${entry.name}/`);
    }
    return entry.name.endsWith(".md")
      ? [`${prefix}${entry.name.slice(0, -3)}`]
      : [];
  });
}

const allSlugs = findSlugs(docsDir);
const slugs = allSlugs.filter((slug) => slug !== INDEX_SLUG);
const fileOf = (slug: string) => path.join(docsDir, ...slug.split("/")) + ".md";

describe("docs directory", () => {
  it("resolves to the repository docs folder", () => {
    expect(existsSync(path.join(docsDir, "README.md"))).toBe(true);
    expect(
      existsSync(path.join(docsDir, "getting-started", "local-setup.md")),
    ).toBe(true);
  });
});

describe("every doc under docs/", () => {
  it("is listed, with a slug and a title", () => {
    expect([...listDocSlugs()].sort()).toEqual([...slugs].sort());
    for (const doc of listDocs()) {
      expect(doc.title.length, doc.slug).toBeGreaterThan(0);
      expect(doc.title, doc.slug).not.toBe(doc.slug);
    }
  });

  it("appears in the sidebar order", () => {
    const missing = slugs.filter((slug) => !DOC_ORDER.includes(slug));
    expect(missing, `add to DOC_SECTIONS: ${missing.join(", ")}`).toEqual([]);
    expect(listDocSlugs()).toEqual(
      DOC_ORDER.filter((slug) => slugs.includes(slug)),
    );
  });

  it("has a summary paragraph and ends with its trade-offs", () => {
    const missing: string[] = [];
    for (const slug of allSlugs) {
      const doc = readDoc(slug)!;
      if (!doc.summary) missing.push(`${slug}: no summary paragraph`);
      if (
        slug !== INDEX_SLUG &&
        !doc.headings.some((h) => h.text === "Design trade-offs and limits")
      ) {
        missing.push(`${slug}: no "Design trade-offs and limits" section`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("only links to repo files that exist", () => {
    const repoRoot = path.resolve(docsDir, "..");
    const base = `${GITHUB_REPO_URL}/blob/${GITHUB_BRANCH}/`;
    const broken: string[] = [];
    for (const slug of allSlugs) {
      const prose = readFileSync(fileOf(slug), "utf8").replace(
        /```[\s\S]*?```/g,
        "",
      );
      for (const [, target = ""] of prose.matchAll(/\]\(([^)\s]+)\)/g)) {
        const { href } = resolveDocTarget(target, "link", slug);
        if (!href.startsWith(base)) continue;
        const repoPath = decodeURIComponent(
          href.slice(base.length).replace(/[?#].*$/, ""),
        );
        if (!existsSync(path.join(repoRoot, repoPath))) {
          broken.push(`${slug}: ${target}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it("only links to docs that exist, and to headings that exist", () => {
    const broken: string[] = [];
    for (const slug of allSlugs) {
      const file = `${slug}.md`;
      const source = readFileSync(fileOf(slug), "utf8");
      const prose = source.replace(/```[\s\S]*?```/g, "");
      for (const [, target = ""] of prose.matchAll(/\]\(([^)\s]+)\)/g)) {
        const resolved = resolveDocTarget(target, "link", slug);
        const match = /^\/docs(?:\/([^#]+))?(?:#(.*))?$/.exec(resolved.href);
        if (!match) continue;
        const [, linked = INDEX_SLUG, hash] = match;
        const doc = readDoc(linked);
        if (!doc) {
          broken.push(`${file}: ${target} (no such doc)`);
        } else if (hash) {
          const slugger = new GithubSlugger();
          const ids = doc.content
            .replace(/```[\s\S]*?```/g, "")
            .split("\n")
            .filter((line) => /^#{1,6}\s/.test(line))
            .map((line) => slugger.slug(line.replace(/^#+\s+/, "")));
          if (!ids.includes(hash)) {
            broken.push(`${file}: ${target} (no heading #${hash})`);
          }
        }
      }
    }
    expect(broken).toEqual([]);
  });
});

describe("the overview", () => {
  it("exists, has a title, and is served at /docs rather than listed", () => {
    expect(readDoc(INDEX_SLUG)?.title).toBeTruthy();
    expect(listDocSlugs()).not.toContain(INDEX_SLUG);
  });

  it("is what links to README.md inside docs/ point at", () => {
    expect(resolveDocTarget("README.md")).toEqual({
      href: "/docs",
      external: false,
    });
    expect(resolveDocTarget("README.md#glossary").href).toBe("/docs#glossary");
    expect(resolveDocTarget("./README.md").href).toBe("/docs");
  });
});

describe("sidebar sections", () => {
  it("list only pages that exist", () => {
    for (const section of DOC_SECTIONS) {
      for (const doc of section.docs) {
        const slug = `${section.dir}/${doc}`;
        expect(existsSync(fileOf(slug)), slug).toBe(true);
      }
    }
  });

  it("group every doc under its folder, in sidebar order", () => {
    const sections = listDocSections();
    expect(sections.flatMap((s) => s.docs.map((d) => d.slug))).toEqual(
      listDocSlugs(),
    );
    for (const section of sections) {
      for (const doc of section.docs) {
        expect(doc.slug.startsWith(`${section.dir}/`), doc.slug).toBe(true);
      }
    }
    expect(sections[0]?.title).toBe("Getting started");
  });
});

describe("sortSlugs", () => {
  it("puts top-level pages first, then folders and pages in the fixed order", () => {
    expect(
      sortSlugs([
        "zeta/b",
        "reference/rest-api",
        "zeta/a",
        "getting-started/zzz",
        "loose",
        "getting-started/monorepo",
        "getting-started/local-setup",
      ]),
    ).toEqual([
      "loose",
      "getting-started/local-setup",
      "getting-started/monorepo",
      "getting-started/zzz",
      "reference/rest-api",
      "zeta/a",
      "zeta/b",
    ]);
  });
});

describe("readDoc", () => {
  it("returns null for unknown, folder or path-like slugs", () => {
    expect(readDoc("nope")).toBeNull();
    expect(readDoc("../README")).toBeNull();
    expect(readDoc("realtime/../README")).toBeNull();
    expect(readDoc("realtime")).toBeNull();
    expect(readDoc("realtime/")).toBeNull();
  });

  it("reads a page inside a folder", () => {
    expect(readDoc("realtime/overview")?.slug).toBe("realtime/overview");
  });
});

describe("isValidSlug", () => {
  it.each([
    ["a", true],
    ["a/b-c", true],
    ["a/b/c/d", true],
    ["a/b/c/d/e", false],
    ["", false],
    ["a//b", false],
    ["a/../b", false],
    ["a/.b", false],
    ["a\\b", false],
  ])("%s is valid: %s", (slug, valid) => {
    expect(isValidSlug(slug)).toBe(valid);
  });
});

describe("redirects", () => {
  it("send a folder to its first page", () => {
    expect(resolveDocRedirect("getting-started")).toBe(
      "getting-started/local-setup",
    );
    expect(resolveDocRedirect("realtime")).toBe("realtime/overview");
  });

  it("send every page of the earlier flat tree somewhere that exists", () => {
    for (const [legacy, target] of Object.entries(LEGACY_SLUGS)) {
      expect(readDoc(target), target).not.toBeNull();
      expect(resolveDocRedirect(legacy)).toBe(target);
    }
  });

  it("are not offered for pages or unknown paths", () => {
    expect(resolveDocRedirect("realtime/overview")).toBeNull();
    expect(resolveDocRedirect("nope")).toBeNull();
    const redirects = listRedirectSlugs();
    expect(redirects).toContain("realtime");
    expect(redirects).toContain("api");
    expect(redirects.some((slug) => listDocSlugs().includes(slug))).toBe(false);
  });
});

describe("getAdjacentDocs", () => {
  it("starts at the overview and walks the sidebar order", () => {
    const order = listDocSlugs();
    expect(getAdjacentDocs(INDEX_SLUG).previous).toBeNull();
    expect(getAdjacentDocs(INDEX_SLUG).next?.slug).toBe(order[0]);
    expect(getAdjacentDocs(order[0]!).previous?.slug).toBe(INDEX_SLUG);
    expect(getAdjacentDocs(order.at(-1)!).next).toBeNull();
    expect(getAdjacentDocs("nope")).toEqual({ previous: null, next: null });
  });
});

describe("docHref", () => {
  it("serves the overview at /docs and pages at their path", () => {
    expect(docHref(INDEX_SLUG)).toBe("/docs");
    expect(docHref("ai/nimbusbot")).toBe("/docs/ai/nimbusbot");
  });
});

describe("extractTitle", () => {
  it("takes the first h1 and ignores fenced comments", () => {
    expect(extractTitle("```sh\n# not a title\n```\n\n# `Real` title\n")).toBe(
      "Real title",
    );
    expect(extractTitle("## only h2")).toBeNull();
  });
});

describe("extractSummary", () => {
  it("joins the first paragraph after the title into one line", () => {
    const md =
      "# T\r\n\r\nFirst [link](x.md) line\r\nsecond `code`.\r\n\r\nNext.";
    expect(extractSummary(md)).toBe("First link line second code.");
  });

  it("is empty when the title is followed by a non-paragraph", () => {
    expect(extractSummary("# T\n\n## Sub\n\ntext")).toBe("");
    expect(extractSummary("# T\n\n- a\n- b")).toBe("");
    expect(extractSummary("no title")).toBe("");
  });
});

describe("extractHeadings", () => {
  it("lists h2s with de-duplicated slugs and skips code fences", () => {
    const md = "# T\n\n## A b\n\n```\n## no\n```\n\n### x\n\n## A b\n";
    expect(extractHeadings(md)).toEqual([
      { id: "a-b", text: "A b" },
      { id: "a-b-1", text: "A b" },
    ]);
  });
});

describe("resolveDocTarget", () => {
  it.each([
    ["./api.md", "/docs/api"],
    ["api.md", "/docs/api"],
    ["./api.md#section", "/docs/api#section"],
    ["api.md#a-b", "/docs/api#a-b"],
  ])("maps %s to %s", (input, href) => {
    expect(resolveDocTarget(input)).toEqual({ href, external: false });
  });

  it("leaves fragments and site paths alone", () => {
    expect(resolveDocTarget("#top")).toEqual({ href: "#top", external: false });
    expect(resolveDocTarget("/login")).toEqual({
      href: "/login",
      external: false,
    });
  });

  it("marks absolute URLs external without rewriting them", () => {
    expect(resolveDocTarget("https://example.com/a")).toEqual({
      href: "https://example.com/a",
      external: true,
    });
    expect(resolveDocTarget("mailto:a@b.co").external).toBe(true);
  });

  it("points repo files outside docs at GitHub", () => {
    const base = `${GITHUB_REPO_URL}/blob/${GITHUB_BRANCH}`;
    expect(resolveDocTarget("../README.md")).toEqual({
      href: `${base}/README.md`,
      external: true,
    });
    expect(resolveDocTarget("../apps/api/src/app.ts#L3").href).toBe(
      `${base}/apps/api/src/app.ts#L3`,
    );
  });

  it("points images at the raw file", () => {
    const raw = `${GITHUB_REPO_URL}/raw/${GITHUB_BRANCH}/docs/img/a.png`;
    expect(resolveDocTarget("img/a.png", "image").href).toBe(raw);
    expect(resolveDocTarget("../img/a.png", "image", "ai/nimbusbot").href).toBe(
      raw,
    );
  });

  it("resolves links from the linking page's own folder", () => {
    const from = "realtime/overview";
    expect(resolveDocTarget("sub/x.md")).toEqual({
      href: "/docs/sub/x",
      external: false,
    });
    expect(resolveDocTarget("canvas-sync.md#a", "link", from)).toEqual({
      href: "/docs/realtime/canvas-sync#a",
      external: false,
    });
    expect(resolveDocTarget("../ai/nimbusbot.md", "link", from).href).toBe(
      "/docs/ai/nimbusbot",
    );
    expect(resolveDocTarget("../README.md", "link", from)).toEqual({
      href: "/docs",
      external: false,
    });
    expect(
      resolveDocTarget("../../apps/api/src/app.ts", "link", from).href,
    ).toBe(`${GITHUB_REPO_URL}/blob/${GITHUB_BRANCH}/apps/api/src/app.ts`);
  });
});
