/**
 * @module web/tests/unit/hooks/useOpenDocument
 * @description Opening a document by id: it is fetched and handed to the
 * editor's add-tab bridge; a failed read, or an editor that is not mounted yet,
 * reports an error instead of throwing, and the error clears on the next try.
 */
import "../../components/testUtils";
import { act, renderHook, waitFor } from "@testing-library/react";
import { http } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  DocEditorRefProvider,
  useDocEditorRef,
} from "../../../components/DocEditorRefContext";
import { useOpenDocument } from "../../../hooks/useOpenDocument";
import { BACKEND_URL, fail, ok } from "../../msw/handlers";
import { server } from "../../msw/server";

const wrapper = ({ children }: { children: ReactNode }) => (
  <DocEditorRefProvider>{children}</DocEditorRefProvider>
);

const doc = {
  id: "d1",
  title: "Notes",
  type: "MARKDOWN",
  canvasData: null,
  yjsState: null,
};

function setup() {
  return renderHook(
    () => ({ opener: useOpenDocument(), ref: useDocEditorRef() }),
    { wrapper },
  );
}

describe("useOpenDocument", () => {
  it("fetches the document and hands it to the editor", async () => {
    server.use(http.get(`${BACKEND_URL}/api/document/d1`, () => ok(doc)));
    const add = vi.fn();
    const { result } = setup();
    result.current.ref.current = add;

    let opened = false;
    await act(async () => {
      opened = await result.current.opener.open("d1");
    });

    expect(opened).toBe(true);
    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({ id: "d1", label: "Notes" }),
    );
    expect(result.current.opener.error).toBeNull();
    expect(result.current.opener.opening).toBeNull();
  });

  it("reports a failed read and clears the error on the next attempt", async () => {
    let ready = false;
    server.use(
      http.get(`${BACKEND_URL}/api/document/d1`, () =>
        ready ? ok(doc) : fail(404, "Document not found"),
      ),
    );
    const add = vi.fn();
    const { result } = setup();
    result.current.ref.current = add;

    await act(async () => {
      expect(await result.current.opener.open("d1")).toBe(false);
    });
    expect(result.current.opener.error).toBe(
      "That document could not be opened.",
    );
    expect(add).not.toHaveBeenCalled();

    ready = true;
    await act(async () => {
      expect(await result.current.opener.open("d1")).toBe(true);
    });
    await waitFor(() => expect(result.current.opener.error).toBeNull());
  });

  it("reports an error when the editor is not mounted", async () => {
    server.use(http.get(`${BACKEND_URL}/api/document/d1`, () => ok(doc)));
    const { result } = setup();

    await act(async () => {
      expect(await result.current.opener.open("d1")).toBe(false);
    });

    expect(result.current.opener.error).toBe(
      "That document could not be opened.",
    );
  });
});
