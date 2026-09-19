/**
 * @module web/tests/unit/hooks/useWorkspaceDocumentForm
 * @description New-document form: Zod validation on the title, the POST to
 * `/api/document/create`, the `ClientDocument` mapping handed to `addTab`, the
 * dialog-close click, and the alert raised on failure.
 */
import { act, renderHook } from "@testing-library/react";
import { http, HttpResponse, type DefaultBodyType } from "msw";
import type { ChangeEvent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BACKEND_URL, fail, ok } from "../../msw/handlers";
import { server } from "../../msw/server";
import { ClientDocument } from "../../../api/document";
import { useWorkspaceDocumentForm } from "../../../hooks/useWorkspaceDocumentForm";

process.env.NEXT_PUBLIC_BACKEND_URL = BACKEND_URL;

const change = (name: string, value: string) =>
  ({ target: { name, value } }) as unknown as ChangeEvent<HTMLInputElement>;

const alertMock = vi.fn();
const WORKSPACE_ID = "cm_workspace_0000000000000";
const CREATE_URL = `${BACKEND_URL}/api/document/create`;

describe("useWorkspaceDocumentForm", () => {
  beforeEach(() => {
    vi.stubGlobal("alert", alertMock);
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to a MARKDOWN document owned by the given workspace", () => {
    const { result } = renderHook(() =>
      useWorkspaceDocumentForm(WORKSPACE_ID),
    );

    expect(result.current.watch("type")).toBe("MARKDOWN");
    expect(result.current.watch("workspaceId")).toBe(WORKSPACE_ID);
    expect(result.current.watch("title")).toBe("");
    expect(result.current.firstError).toBeUndefined();
  });

  it("rejects a title shorter than 3 characters without calling the API", async () => {
    const spy = vi.fn();
    server.use(
      http.post(CREATE_URL, () => {
        spy();
        return ok({});
      }),
    );

    const { result } = renderHook(() =>
      useWorkspaceDocumentForm(WORKSPACE_ID),
    );
    act(() => {
      result.current.register("title").onChange(change("title", "ab"));
    });

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(result.current.firstError).toBe(
      "Title must be at least 3 characters",
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects a title longer than 50 characters", async () => {
    const { result } = renderHook(() =>
      useWorkspaceDocumentForm(WORKSPACE_ID),
    );
    act(() => {
      result.current
        .register("title")
        .onChange(change("title", "t".repeat(51)));
    });

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(result.current.firstError).toBe(
      "Title must be at most 50 characters",
    );
  });

  it("creates the document and hands a ClientDocument to addTab", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(CREATE_URL, async ({ request }) => {
        bodies.push(await request.json());
        return ok({
          id: "cm_document_00000000000000",
          title: "Design Notes",
          type: "MARKDOWN",
          canvasData: null,
          yjsState: null,
        });
      }),
    );

    const addTab = vi.fn();
    const { result } = renderHook(() =>
      useWorkspaceDocumentForm(WORKSPACE_ID, addTab),
    );
    act(() => {
      result.current.register("title").onChange(change("title", "Design Notes"));
    });

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(bodies).toEqual([
      {
        title: "Design Notes",
        type: "MARKDOWN",
        workspaceId: WORKSPACE_ID,
      },
    ]);

    const opened = addTab.mock.calls[0]?.[0] as ClientDocument;
    expect(opened).toEqual({
      id: "cm_document_00000000000000",
      label: "Design Notes",
      type: "MARKDOWN",
      elements: [],
      yjsState: null,
    });
  });

  it("carries an existing canvas element array through to addTab", async () => {
    server.use(
      http.post(CREATE_URL, () =>
        ok({
          id: "cm_document_00000000000000",
          title: "Sketchpad",
          type: "CANVAS",
          canvasData: [{ id: "el-1" }, { id: "el-2" }],
          yjsState: "binary-blob",
        }),
      ),
    );

    const addTab = vi.fn();
    const { result } = renderHook(() =>
      useWorkspaceDocumentForm(WORKSPACE_ID, addTab),
    );
    act(() => {
      result.current.register("title").onChange(change("title", "Sketchpad"));
      result.current.setValue("type", "CANVAS");
    });

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(addTab.mock.calls[0]?.[0]).toMatchObject({
      type: "CANVAS",
      elements: [{ id: "el-1" }, { id: "el-2" }],
      yjsState: "binary-blob",
    });
  });

  it("closes the dialog and clears the form after a successful create", async () => {
    server.use(
      http.post(CREATE_URL, () =>
        ok({
          id: "cm_document_00000000000000",
          title: "Design Notes",
          type: "MARKDOWN",
        }),
      ),
    );

    const closeButton = document.createElement("button");
    closeButton.id = "close-doc-dialog";
    const onClick = vi.fn();
    closeButton.addEventListener("click", onClick);
    document.body.appendChild(closeButton);

    const { result } = renderHook(() =>
      useWorkspaceDocumentForm(WORKSPACE_ID),
    );
    act(() => {
      result.current.register("title").onChange(change("title", "Design Notes"));
    });

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(result.current.watch("title")).toBe("");
  });

  it("survives a successful create when the close control is absent", async () => {
    server.use(
      http.post(CREATE_URL, () =>
        ok({ id: "cm_document_00000000000000", title: "Design Notes", type: "MARKDOWN" }),
      ),
    );

    const addTab = vi.fn();
    const { result } = renderHook(() =>
      useWorkspaceDocumentForm(WORKSPACE_ID, addTab),
    );
    act(() => {
      result.current.register("title").onChange(change("title", "Design Notes"));
    });

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(addTab).toHaveBeenCalledTimes(1);
    expect(alertMock).not.toHaveBeenCalled();
  });

  it("alerts the envelope message and opens nothing when creation fails", async () => {
    server.use(
      http.post(CREATE_URL, () => fail(400, "Document limit reached")),
    );

    const addTab = vi.fn();
    const { result } = renderHook(() =>
      useWorkspaceDocumentForm(WORKSPACE_ID, addTab),
    );
    act(() => {
      result.current.register("title").onChange(change("title", "Design Notes"));
    });

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(alertMock).toHaveBeenCalledWith("Document limit reached");
    expect(addTab).not.toHaveBeenCalled();
  });

  it("falls back to a generic alert when the failure body has no message", async () => {
    server.use(
      http.post(CREATE_URL, () =>
        HttpResponse.json({ success: false }, { status: 500 }),
      ),
    );

    const { result } = renderHook(() =>
      useWorkspaceDocumentForm(WORKSPACE_ID),
    );
    act(() => {
      result.current.register("title").onChange(change("title", "Design Notes"));
    });

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(alertMock).toHaveBeenCalledWith(
      "Something went wrong. Please try again.",
    );
  });

  it("works without an addTab callback", async () => {
    server.use(
      http.post(CREATE_URL, () =>
        ok({ id: "cm_document_00000000000000", title: "Design Notes", type: "MARKDOWN" }),
      ),
    );

    const { result } = renderHook(() =>
      useWorkspaceDocumentForm(WORKSPACE_ID),
    );
    act(() => {
      result.current.register("title").onChange(change("title", "Design Notes"));
    });

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(result.current.isSubmitting).toBe(false);
    expect(alertMock).not.toHaveBeenCalled();
  });

  it("reports isSubmitting while the create request is pending", async () => {
    let release: (() => void) | undefined;
    server.use(
      http.post(
        CREATE_URL,
        () =>
          new Promise<HttpResponse<DefaultBodyType>>((resolve) => {
            release = () =>
              resolve(ok({ id: "cm_document_00000000000000", title: "Design Notes", type: "MARKDOWN" }));
          }),
      ),
    );

    const { result } = renderHook(() =>
      useWorkspaceDocumentForm(WORKSPACE_ID),
    );
    act(() => {
      result.current.register("title").onChange(change("title", "Design Notes"));
    });

    let pending: Promise<void>;
    await act(async () => {
      pending = result.current.onSubmit();
    });

    expect(result.current.isSubmitting).toBe(true);

    await act(async () => {
      release?.();
      await pending;
    });

    expect(result.current.isSubmitting).toBe(false);
  });
});
