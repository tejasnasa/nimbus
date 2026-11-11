/**
 * @module web/tests/components/SaveBlob
 * @description The temporary-anchor save, which needs a DOM.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { saveBlob } from "../../lib/documentDownload";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("saveBlob", () => {
  it("clicks a temporary anchor with the file name, then removes it and frees the URL", () => {
    vi.useFakeTimers();
    const realCreate = URL.createObjectURL;
    const realRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => "blob:abc");
    URL.revokeObjectURL = vi.fn();
    const seen: Array<{ href: string; download: string; inDom: boolean }> = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      seen.push({
        href: this.href,
        download: this.download,
        inDom: document.body.contains(this),
      });
    });

    saveBlob(new Blob(["x"]), "file.md");

    expect(seen).toEqual([
      { href: "blob:abc", download: "file.md", inDom: true },
    ]);
    expect(document.querySelector("a[download]")).toBeNull();
    vi.runAllTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:abc");

    URL.createObjectURL = realCreate;
    URL.revokeObjectURL = realRevoke;
    vi.useRealTimers();
  });
});
