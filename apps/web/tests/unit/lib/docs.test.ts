import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import GithubSlugger from "github-slugger";
import { describe, expect, it } from "vitest";
import {
  DOC_ORDER,
  GITHUB_BRANCH,
  GITHUB_REPO_URL,
  INDEX_SLUG,
  extractHeadings,
  extractSummary,
  extractTitle,
  listDocSlugs,
  listDocs,
  readDoc,
  resolveDocTarget,
  resolveDocsDir,
  sortSlugs,
} from "../../../lib/docs";

const docsDir = resolveDocsDir();
const files = readdirSync(docsDir).filter((name) => name.endsWith(".md"));
const slugs = files
  .map((name) => name.slice(0, -3))
  .filter((slug) => slug !== INDEX_SLUG);

describe("docs directory", () => {
  it("resolves to the repository docs folder", () => {
    expect(existsSync(path.join(docsDir, "getting-started.md"))).toBe(true);
  });
});

describe("every docs/*.md file", () => {
  it("is listed, with a slug and a title", () => {
    expect([...listDocSlugs()].sort()).toEqual([...slugs].sort());
    for (const doc of listDocs()) {
      expect(doc.title.length, doc.slug).toBeGreaterThan(0);
      expect(doc.title, doc.slug).not.toBe(doc.slug);
    }
  });

  it("appears in the sidebar order", () => {
    const missing = slugs.filter(
      (slug) => !(DOC_ORDER as readonly string[]).includes(slug),
    );
    expect(missing, `add to DOC_ORDER: ${missing.join(", ")}`).toEqual([]);
    expect(listDocSlugs()).toEqual(
      DOC_ORDER.filter((slug) => slugs.includes(slug)),
    );
  });

  it("only links to docs that exist, and to headings that exist", () => {
    const broken: string[] = [];
    for (const file of files) {
      const source = readFileSync(path.join(docsDir, file), "utf8");
      const prose = source.replace(/```[\s\S]*?```/g, "");
      for (const [, target = ""] of prose.matchAll(/\]\(([^)\s]+)\)/g)) {
        const resolved = resolveDocTarget(target);
        const match = /^\/docs(?:\/([^#]+))?(?:#(.*))?$/.exec(resolved.href);
        if (!match) continue;
        const [, slug = INDEX_SLUG, hash] = match;
        const doc = readDoc(slug);
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

describe("sortSlugs", () => {
  it("follows the fixed order, then appends unknown docs alphabetically", () => {
    expect(sortSlugs(["zeta", "api", "alpha", "getting-started"])).toEqual([
      "getting-started",
      "api",
      "alpha",
      "zeta",
    ]);
  });
});

describe("readDoc", () => {
  it("returns null for unknown or path-like slugs", () => {
    expect(readDoc("nope")).toBeNull();
    expect(readDoc("../README")).toBeNull();
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

  it("points images at the raw file and docs subfolders at GitHub", () => {
    expect(resolveDocTarget("img/a.png", "image").href).toBe(
      `${GITHUB_REPO_URL}/raw/${GITHUB_BRANCH}/docs/img/a.png`,
    );
    expect(resolveDocTarget("sub/x.md").external).toBe(true);
  });
});
