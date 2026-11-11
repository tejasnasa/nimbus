/**
 * @module web/lib/documentDownload
 * @description Saves a document to the user's machine: markdown as a `.md`
 * file, a canvas as a `.png` rendered in the browser by Excalidraw. The content
 * comes from the export endpoint, so a document that is open and being edited
 * is saved as the server last saw it, flushed first.
 *
 * @important The canvas renderer is imported on demand. Excalidraw is large,
 *            and only a download needs it from this module.
 *
 * @important File names are built from the title with every character a file
 *            system or the download attribute could misread replaced, so a
 *            title can never choose a path or an extension.
 */
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { exportDocument } from "./documentApi";

/** Longest file name stem produced from a title. */
const FILE_STEM_MAX = 80;

/**
 * Turns a document title into a safe file name stem.
 *
 * @param title - The document title.
 * @returns The stem without an extension; "document" when nothing is left.
 */
export function sanitizeFileName(title: string): string {
  const stem = title
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .replace(/[. ]+$/, "")
    .slice(0, FILE_STEM_MAX)
    .trim();
  return stem || "document";
}

/**
 * Hands a blob to the browser as a download through a temporary anchor.
 *
 * @param blob - The file content.
 * @param fileName - The name to save it as.
 */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** The outcome of {@link downloadDocument}. */
export type DownloadResult = { ok: true } | { ok: false; message: string };

/**
 * Downloads a document: markdown as `.md`, a canvas as `.png`.
 *
 * @param documentId - The document cuid.
 * @param title - Its title, used for the file name.
 * @returns Whether it was saved, or a message safe to show.
 */
export async function downloadDocument(
  documentId: string,
  title: string,
): Promise<DownloadResult> {
  const exported = await exportDocument(documentId);
  if (!exported.ok) return { ok: false, message: exported.message };
  const stem = sanitizeFileName(exported.data.title || title);

  if (exported.data.type === "MARKDOWN") {
    saveBlob(
      new Blob([exported.data.markdown], {
        type: "text/markdown;charset=utf-8",
      }),
      `${stem}.md`,
    );
    return { ok: true };
  }

  const elements = exported.data.elements as OrderedExcalidrawElement[];
  if (!elements.some((element) => !element.isDeleted)) {
    return {
      ok: false,
      message: "This canvas is empty, so there is nothing to download.",
    };
  }
  try {
    const { exportToBlob } = await import("@excalidraw/excalidraw");
    const blob = await exportToBlob({
      elements,
      appState: { exportBackground: true, exportWithDarkMode: false },
      files: null,
      mimeType: "image/png",
    });
    saveBlob(blob, `${stem}.png`);
    return { ok: true };
  } catch {
    return { ok: false, message: "The canvas could not be rendered." };
  }
}
