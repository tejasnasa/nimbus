/**
 * @module api/__tests__/unit/documentText
 * @description Text extraction and markdown export over hand-built Yjs trees
 * shaped like the ones the editor writes, canvas element arrays and markdown
 * seeds. Pure: no database, no network.
 */
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  extractCanvasText,
  extractYjsStateText,
  extractYjsText,
  markdownToText,
  SEARCH_TEXT_MAX,
  searchTextForNew,
  yjsStateToMarkdown,
  yjsToMarkdown,
} from "../../lib/documentText";

type Parent = Y.XmlFragment | Y.XmlElement;
type Run = string | [string, Record<string, unknown>];

/** Appends an element to a parent and returns it. */
const el = (
  parent: Parent,
  name: string,
  attrs: Record<string, string | number | boolean> = {},
) => {
  const node = new Y.XmlElement(name);
  parent.insert(parent.length, [node]);
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, value as never);
  }
  return node;
};

/** Appends a text node holding the runs. */
const text = (parent: Y.XmlElement, runs: Run[]) => {
  const node = new Y.XmlText();
  parent.insert(parent.length, [node]);
  // A delta states each run's marks exactly; `insert` would inherit the
  // marks of the run before it.
  node.applyDelta(
    runs.map((run) =>
      typeof run === "string"
        ? { insert: run }
        : { insert: run[0], attributes: run[1] },
    ),
  );
  return node;
};

/** A paragraph with the runs. */
const para = (parent: Parent, ...runs: Run[]) => {
  const node = el(parent, "paragraph");
  text(node, runs);
  return node;
};

const newDoc = () => {
  const doc = new Y.Doc();
  return { doc, root: doc.getXmlFragment("prosemirror") };
};

describe("extractYjsText", () => {
  it("returns an empty string for an empty document", () => {
    expect(extractYjsText(new Y.Doc())).toBe("");
  });

  it("puts every block on its own line and ignores formatting marks", () => {
    const { doc, root } = newDoc();
    const heading = el(root, "heading", { level: 1 });
    text(heading, ["Launch plan"]);
    para(root, "We ", ["ship", { strong: {} }], " on Friday.");
    const list = el(root, "bullet_list");
    for (const item of ["rollback", "changelog"]) {
      const li = el(list, "list_item");
      para(li, item);
    }

    expect(extractYjsText(doc)).toBe(
      "Launch plan\nWe ship on Friday.\nrollback\nchangelog",
    );
  });

  it("reads table cells, code blocks, image alt text and hard breaks", () => {
    const { doc, root } = newDoc();
    const table = el(root, "table");
    const row = el(table, "table_row");
    for (const cell of ["alpha", "beta"]) {
      para(el(row, "table_cell"), cell);
    }
    const code = el(root, "code_block", { language: "ts" });
    text(code, ["const x = 1;"]);
    const p = el(root, "paragraph");
    text(p, ["line one"]);
    el(p, "hardbreak");
    text(p, ["line two"]);
    el(root, "paragraph");
    const withImage = el(root, "paragraph");
    el(withImage, "image", { src: "https://x.test/a.png", alt: "diagram" });

    const out = extractYjsText(doc);

    expect(out).toContain("alpha\nbeta");
    expect(out).toContain("const x = 1;");
    expect(out).toContain("line one\nline two");
    expect(out).toContain("diagram");
    expect(out).not.toContain("https://x.test");
  });

  it("keeps the text of an element it does not know", () => {
    const { doc, root } = newDoc();
    const unknown = el(root, "callout");
    para(unknown, "inside a custom block");

    expect(extractYjsText(doc)).toBe("inside a custom block");
  });

  it("caps the stored text", () => {
    const { doc, root } = newDoc();
    para(root, "x".repeat(SEARCH_TEXT_MAX + 500));

    expect(extractYjsText(doc)).toHaveLength(SEARCH_TEXT_MAX);
  });
});

describe("extractYjsStateText", () => {
  it("decodes a persisted state", () => {
    const { doc, root } = newDoc();
    para(root, "persisted words");

    expect(extractYjsStateText(Y.encodeStateAsUpdate(doc))).toBe(
      "persisted words",
    );
  });

  it("returns an empty string for bytes that are not a Yjs update", () => {
    expect(extractYjsStateText(Uint8Array.from([255, 255, 255, 9]))).toBe("");
  });
});

describe("extractCanvasText", () => {
  it("collects text elements, bound labels and frame names", () => {
    const elements = [
      { type: "rectangle", id: "r1" },
      { type: "text", id: "t1", text: "Login service", containerId: "r1" },
      {
        type: "text",
        id: "t2",
        text: "free label",
        originalText: "free label",
      },
      { type: "frame", id: "f1", name: "Phase board" },
      { type: "arrow", id: "a1" },
    ];

    expect(extractCanvasText(elements)).toBe(
      "Login service\nfree label\nPhase board",
    );
  });

  it("skips deleted elements and blank text", () => {
    expect(
      extractCanvasText([
        { type: "text", text: "gone", isDeleted: true },
        { type: "text", text: "   " },
        { type: "text", text: "kept" },
        null,
        "junk",
      ]),
    ).toBe("kept");
  });

  it("falls back to the original text of a wrapped label", () => {
    expect(extractCanvasText([{ type: "text", originalText: "orig" }])).toBe(
      "orig",
    );
  });

  it("returns an empty string for anything that is not an array", () => {
    expect(extractCanvasText(null)).toBe("");
    expect(extractCanvasText({ type: "text", text: "x" })).toBe("");
  });
});

describe("markdownToText", () => {
  it("strips structure and keeps the words", () => {
    const md = [
      "# Title",
      "",
      "Some **bold** and *italic* with `code` and a [link](https://x.test).",
      "",
      "> quoted",
      "",
      "- [x] done item",
      "1. first",
      "",
      "---",
      "",
      "| a | b |",
      "| --- | --- |",
      "| c | d |",
      "",
      "```ts",
      "const kept = 1;",
      "```",
      "![alt text](https://x.test/i.png)",
    ].join("\n");

    const out = markdownToText(md);

    expect(out).toContain("Title");
    expect(out).toContain("Some bold and italic with code and a link.");
    expect(out).toContain("quoted");
    expect(out).toContain("done item");
    expect(out).toContain("first");
    expect(out).toContain("const kept = 1;");
    expect(out).toContain("alt text");
    expect(out).not.toMatch(/[#*>`|]/);
    expect(out).not.toContain("https://");
    expect(out).not.toContain("---");
  });
});

describe("searchTextForNew", () => {
  it("prefers a markdown seed, then canvas text, else null", () => {
    expect(searchTextForNew({ initialContent: "# Hello" })).toBe("Hello");
    expect(
      searchTextForNew({ canvasData: [{ type: "text", text: "box" }] }),
    ).toBe("box");
    expect(searchTextForNew({ canvasData: [] })).toBeNull();
    expect(searchTextForNew({})).toBeNull();
  });
});

describe("yjsToMarkdown", () => {
  it("returns an empty string for an empty document", () => {
    expect(yjsToMarkdown(new Y.Doc())).toBe("");
  });

  it("writes headings, paragraphs and inline marks", () => {
    const { doc, root } = newDoc();
    text(el(root, "heading", { level: 2 }), ["Plan"]);
    para(
      root,
      "A ",
      ["bold", { strong: {} }],
      " ",
      ["slanted", { emphasis: {} }],
      " ",
      ["struck", { strike_through: {} }],
      " ",
      ["code", { inlineCode: {} }],
      " and ",
      ["a link", { link: { href: "https://x.test", title: "T" } }],
      ".",
    );

    expect(yjsToMarkdown(doc)).toBe(
      '## Plan\n\nA **bold** *slanted* ~~struck~~ `code` and [a link](https://x.test "T").\n',
    );
  });

  it("keeps whitespace outside of marks", () => {
    const { doc, root } = newDoc();
    para(root, ["bold ", { strong: {} }], "after");

    expect(yjsToMarkdown(doc)).toBe("**bold** after\n");
  });

  it("writes bullet, ordered, nested and task lists", () => {
    const { doc, root } = newDoc();
    const bullets = el(root, "bullet_list");
    const first = el(bullets, "list_item");
    para(first, "one");
    const nested = el(first, "ordered_list", { order: 3 });
    para(el(nested, "list_item"), "three");
    para(el(nested, "list_item"), "four");
    para(el(bullets, "list_item", { checked: true }), "done");
    para(el(bullets, "list_item", { checked: false }), "todo");

    expect(yjsToMarkdown(doc)).toBe(
      ["- one", "  3. three", "  4. four", "- [x] done", "- [ ] todo", ""].join(
        "\n",
      ),
    );
  });

  it("writes block quotes, code fences and rules", () => {
    const { doc, root } = newDoc();
    const quote = el(root, "blockquote");
    para(quote, "first");
    para(quote, "second");
    text(el(root, "code_block", { language: "ts" }), ["const a = 1;"]);
    el(root, "hr");

    expect(yjsToMarkdown(doc)).toBe(
      "> first\n>\n> second\n\n```ts\nconst a = 1;\n```\n\n---\n",
    );
  });

  it("writes a table with a header rule and escapes pipes in cells", () => {
    const { doc, root } = newDoc();
    const table = el(root, "table");
    const header = el(table, "table_header_row");
    para(el(header, "table_header"), "Name");
    para(el(header, "table_header"), "Note");
    const row = el(table, "table_row");
    para(el(row, "table_cell"), "x");
    para(el(row, "table_cell"), "a | b");

    expect(yjsToMarkdown(doc)).toBe(
      "| Name | Note |\n| --- | --- |\n| x | a \\| b |\n",
    );
  });

  it("writes images and hard breaks", () => {
    const { doc, root } = newDoc();
    const p = el(root, "paragraph");
    text(p, ["see "]);
    el(p, "image", { src: "https://x.test/a.png", alt: "pic" });
    el(p, "hardbreak");
    text(p, ["next"]);
    el(root, "image", { src: "https://x.test/b.png" });

    expect(yjsToMarkdown(doc)).toBe(
      "see ![pic](https://x.test/a.png)  \nnext\n\n![](https://x.test/b.png)\n",
    );
  });

  it("falls back to the text of an element it does not know", () => {
    const { doc, root } = newDoc();
    const unknown = el(root, "callout");
    para(unknown, "kept");

    expect(yjsToMarkdown(doc)).toBe("kept\n");
  });
});

describe("yjsStateToMarkdown", () => {
  it("renders a persisted state and returns empty for garbage", () => {
    const { doc, root } = newDoc();
    para(root, "hello");

    expect(yjsStateToMarkdown(Y.encodeStateAsUpdate(doc))).toBe("hello\n");
    expect(yjsStateToMarkdown(Uint8Array.from([255, 255, 255, 9]))).toBe("");
  });
});
