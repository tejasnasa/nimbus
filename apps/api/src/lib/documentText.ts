/**
 * @module api/lib/documentText
 * @description Pure text extraction for documents: the plain text that feeds
 * keyword search (from a markdown document's Yjs tree, a canvas's element array
 * or a markdown seed) and a markdown rendering of a Yjs document for export.
 *
 * @important The Yjs walk reads the `"prosemirror"` fragment the Milkdown
 *            editor writes through y-prosemirror: element names are Milkdown's
 *            commonmark and GFM node names (`paragraph`, `heading`,
 *            `bullet_list`, `table_row`, …) and marks are text attributes
 *            (`strong`, `emphasis`, `inlineCode`, `link`, `strike_through`).
 *            A node this module does not know is read as a plain container, so
 *            its text is kept; a rename in the editor's schema degrades the
 *            export's formatting, not the search text.
 *
 * @important {@link yjsToMarkdown} is a purpose-built serializer for that node
 *            set, not Milkdown's own: the editor packages are ESM-only
 *            browser-oriented modules that cannot be loaded here. Text is
 *            written without escaping markdown punctuation.
 *
 * @important Search text is capped at {@link SEARCH_TEXT_MAX} characters.
 *            Postgres refuses a `tsvector` larger than 1 MB, and an update
 *            that fails would lose the document's snapshot along with it.
 */
import * as Y from "yjs";

/** Longest search text stored for one document. */
export const SEARCH_TEXT_MAX = 200_000;

/** Name of the fragment the editor's content lives in. */
const FRAGMENT = "prosemirror";

type DeltaOp = { insert?: unknown; attributes?: Record<string, unknown> };

const isElement = (node: unknown): node is Y.XmlElement =>
  node instanceof Y.XmlElement;
const isText = (node: unknown): node is Y.XmlText => node instanceof Y.XmlText;

/** Trims, caps and normalises line endings of extracted text. */
function finish(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, SEARCH_TEXT_MAX);
}

/** The text a Yjs text node holds, ignoring embeds. */
function textOf(node: Y.XmlText): string {
  return (node.toDelta() as DeltaOp[])
    .map((op) => (typeof op.insert === "string" ? op.insert : ""))
    .join("");
}

/**
 * Plain text of a Yjs document: every paragraph, heading, list item, table cell
 * and code line on a line of its own.
 *
 * @param doc - The collaborative document.
 * @returns The text, or an empty string for a document with no content.
 */
export function extractYjsText(doc: Y.Doc): string {
  const lines: string[] = [];
  let current = "";
  const flush = () => {
    if (current.trim()) lines.push(current);
    current = "";
  };
  const walk = (node: Y.XmlElement | Y.XmlText | Y.XmlFragment | unknown) => {
    if (isText(node)) {
      current += textOf(node);
      return;
    }
    if (isElement(node)) {
      if (node.nodeName === "hardbreak") {
        current += "\n";
        return;
      }
      if (node.nodeName === "image") {
        const alt = node.getAttribute("alt");
        if (typeof alt === "string") current += alt;
        return;
      }
      flush();
      for (const child of node.toArray()) walk(child);
      flush();
      return;
    }
    if (node instanceof Y.XmlFragment) {
      for (const child of node.toArray()) walk(child);
    }
  };
  walk(doc.getXmlFragment(FRAGMENT));
  flush();
  return finish(lines.join("\n"));
}

/**
 * Plain text of a persisted Yjs state.
 *
 * @param state - The bytes of `Y.encodeStateAsUpdate`.
 * @returns The text; empty when the state cannot be applied.
 */
export function extractYjsStateText(state: Uint8Array): string {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
    return extractYjsText(doc);
  } catch {
    return "";
  } finally {
    doc.destroy();
  }
}

/**
 * Plain text of a canvas: the text of every live text element (which includes
 * the labels bound to shapes and arrows) and the names of frames.
 *
 * @param elements - The Excalidraw element array, as stored; anything else
 *                   yields an empty string.
 */
export function extractCanvasText(elements: unknown): string {
  if (!Array.isArray(elements)) return "";
  const lines: string[] = [];
  for (const raw of elements) {
    if (!raw || typeof raw !== "object") continue;
    const el = raw as Record<string, unknown>;
    if (el.isDeleted === true) continue;
    if (el.type === "text") {
      const text = typeof el.text === "string" ? el.text : el.originalText;
      if (typeof text === "string" && text.trim()) lines.push(text.trim());
    } else if (
      (el.type === "frame" || el.type === "magicframe") &&
      typeof el.name === "string" &&
      el.name.trim()
    ) {
      lines.push(el.name.trim());
    }
  }
  return finish(lines.join("\n"));
}

/**
 * Plain text of a markdown seed: structure markers removed, words kept.
 *
 * @param markdown - Markdown source, such as a generated document's body.
 */
export function markdownToText(markdown: string): string {
  const text = markdown
    .replace(/```[^\n]*\n([\s\S]*?)```/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s+)?/gm, "")
    .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, "")
    .replace(/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/gm, "")
    .replace(/\|/g, " ")
    .replace(/(\*\*|__|~~|[*`])/g, "");
  return finish(text);
}

/** Wraps marked text, keeping edge whitespace outside the markers. */
function applyMarks(text: string, attrs: Record<string, unknown> | undefined) {
  if (!attrs || !text) return text;
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
  if (!match || !match[2]) return text;
  const [, lead = "", core = "", trail = ""] = match;
  let out = core;
  if ("inlineCode" in attrs) out = `\`${out}\``;
  if ("strike_through" in attrs) out = `~~${out}~~`;
  if ("emphasis" in attrs) out = `*${out}*`;
  if ("strong" in attrs) out = `**${out}**`;
  const link = attrs.link;
  if (link && typeof link === "object") {
    const { href, title } = link as { href?: unknown; title?: unknown };
    if (typeof href === "string") {
      out = `[${out}](${href}${typeof title === "string" && title ? ` "${title}"` : ""})`;
    }
  }
  return `${lead}${out}${trail}`;
}

/** Inline content of a block: marked text, images and line breaks. */
function inlineMarkdown(node: Y.XmlElement): string {
  let out = "";
  for (const child of node.toArray()) {
    if (isText(child)) {
      for (const op of child.toDelta() as DeltaOp[]) {
        if (typeof op.insert === "string") {
          out += applyMarks(op.insert, op.attributes);
        }
      }
    } else if (isElement(child)) {
      if (child.nodeName === "hardbreak") out += "  \n";
      else if (child.nodeName === "image") {
        const src = child.getAttribute("src");
        const alt = child.getAttribute("alt");
        if (typeof src === "string") {
          out += `![${typeof alt === "string" ? alt : ""}](${src})`;
        }
      } else out += inlineMarkdown(child);
    }
  }
  return out;
}

/** Prefixes the first line and indents the rest to its width. */
function hang(prefix: string, body: string): string {
  const pad = " ".repeat(prefix.length);
  return body
    .split("\n")
    .map((line, index) =>
      index === 0 ? `${prefix}${line}` : line ? `${pad}${line}` : line,
    )
    .join("\n");
}

/** Markdown of a block's child blocks, joined by `separator`. */
function blocks(node: Y.XmlElement | Y.XmlFragment, separator: string) {
  const parts: string[] = [];
  for (const child of node.toArray()) {
    if (!isElement(child)) continue;
    const md = blockMarkdown(child);
    if (md !== "") parts.push(md);
  }
  return parts.join(separator);
}

/** One table row's cells as a markdown row. */
function tableRow(row: Y.XmlElement): string[] {
  return row
    .toArray()
    .filter(isElement)
    .map((cell) =>
      blocks(cell, " ").replace(/\n/g, " ").replace(/\|/g, "\\|").trim(),
    );
}

function blockMarkdown(node: Y.XmlElement): string {
  const attrs = node.getAttributes() as Record<string, unknown>;
  switch (node.nodeName) {
    case "paragraph":
      return inlineMarkdown(node);
    case "heading": {
      const level = Math.min(Math.max(Number(attrs.level) || 1, 1), 6);
      return `${"#".repeat(level)} ${inlineMarkdown(node)}`;
    }
    case "blockquote":
      return blocks(node, "\n\n")
        .split("\n")
        .map((line) => (line ? `> ${line}` : ">"))
        .join("\n");
    case "code_block": {
      const language = typeof attrs.language === "string" ? attrs.language : "";
      const code = node
        .toArray()
        .map((child) => (isText(child) ? textOf(child) : ""))
        .join("");
      return `\`\`\`${language}\n${code}\n\`\`\``;
    }
    case "hr":
      return "---";
    case "bullet_list":
    case "ordered_list": {
      const ordered = node.nodeName === "ordered_list";
      const start = Number(attrs.order) || 1;
      return node
        .toArray()
        .filter(isElement)
        .map((item, index) => {
          const itemAttrs = item.getAttributes() as Record<string, unknown>;
          const task =
            typeof itemAttrs.checked === "boolean"
              ? itemAttrs.checked
                ? "[x] "
                : "[ ] "
              : "";
          const marker = ordered ? `${start + index}. ` : "- ";
          return hang(marker, `${task}${blocks(item, "\n")}`);
        })
        .join("\n");
    }
    case "table": {
      const rows = node
        .toArray()
        .filter(isElement)
        .map(tableRow)
        .filter((cells) => cells.length > 0);
      const [header, ...body] = rows;
      if (!header) return "";
      const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
      return [
        line(header),
        line(header.map(() => "---")),
        ...body.map(line),
      ].join("\n");
    }
    case "image": {
      const src = attrs.src;
      return typeof src === "string"
        ? `![${typeof attrs.alt === "string" ? attrs.alt : ""}](${src})`
        : "";
    }
    default:
      return blocks(node, "\n\n") || inlineMarkdown(node);
  }
}

/**
 * Renders a Yjs document as markdown.
 *
 * @param doc - The collaborative document.
 * @returns The markdown, ending in a newline; an empty string when there is no
 *          content.
 */
export function yjsToMarkdown(doc: Y.Doc): string {
  const markdown = blocks(doc.getXmlFragment(FRAGMENT), "\n\n").trim();
  return markdown ? `${markdown}\n` : "";
}

/**
 * Renders a persisted Yjs state as markdown.
 *
 * @param state - The bytes of `Y.encodeStateAsUpdate`.
 * @returns The markdown; empty when the state cannot be applied.
 */
export function yjsStateToMarkdown(state: Uint8Array): string {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
    return yjsToMarkdown(doc);
  } catch {
    return "";
  } finally {
    doc.destroy();
  }
}

/**
 * Search text for a document created with content already in hand.
 *
 * @param content - A canvas's element array, a markdown seed, or both absent.
 * @returns The text to store, or null when there is none.
 */
export function searchTextForNew(content: {
  canvasData?: unknown;
  initialContent?: string | null;
}): string | null {
  const text = content.initialContent
    ? markdownToText(content.initialContent)
    : extractCanvasText(content.canvasData);
  return text || null;
}
