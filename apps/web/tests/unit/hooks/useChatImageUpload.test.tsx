/**
 * @module web/tests/unit/hooks/useChatImageUpload
 * @description Chat image upload: client-side validation (type, HEIC by name,
 * the 10 MB cap), the signature fetch, the exact signed field set posted to
 * Cloudinary, progress reporting, cancellation at both stages and the error
 * paths.
 *
 * Two surfaces are faked: `global.fetch` (the signature request) and
 * `XMLHttpRequest` (the Cloudinary upload, which needs XHR for progress). No
 * network and no Cloudinary key is involved.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_CHAT_IMAGE_BYTES,
  useChatImageUpload,
  validateChatImage,
} from "../../../hooks/useChatImageUpload";

process.env.NEXT_PUBLIC_BACKEND_URL = "http://localhost:3001";

const SIG = {
  cloudName: "test-cloud",
  apiKey: "key-1",
  timestamp: 1_700_000_000,
  folder: "nimbus/chat/ws1",
  publicId: "ckpublicid",
  allowedFormats: "jpg,png,webp,heic",
  transformation: "c_limit,w_2048,h_2048",
  context: "uploader=u1",
  signature: "sig-1",
};
const SECURE_URL =
  "https://res.cloudinary.com/test-cloud/image/upload/v1/nimbus/chat/ws1/ckpublicid.jpg";

/** Records every request and lets a test drive its events by hand. */
class FakeXHR {
  static instances: FakeXHR[] = [];
  method = "";
  url = "";
  body: FormData | null = null;
  status = 0;
  responseText = "";
  aborted = false;
  upload: { onprogress: ((e: unknown) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;

  constructor() {
    FakeXHR.instances.push(this);
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  send(body: FormData) {
    this.body = body;
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
  progress(loaded: number, total: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total });
  }
  finish(status: number, body: unknown) {
    this.status = status;
    this.responseText = typeof body === "string" ? body : JSON.stringify(body);
    this.onload?.();
  }
}

const makeFile = (type = "image/png", size = 1024, name = "pic.png") =>
  new File([new Uint8Array(size)], name, { type });

const signatureResponse = () =>
  new Response(
    JSON.stringify({ success: true, message: "OK", responseObject: SIG }),
    { status: 200 },
  );

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  FakeXHR.instances = [];
  vi.stubGlobal("XMLHttpRequest", FakeXHR);
  fetchMock = vi.fn(async () => signatureResponse());
  vi.stubGlobal("fetch", fetchMock);
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Lets the signature fetch settle so the XHR exists. */
const settle = () => act(async () => {});

describe("validateChatImage", () => {
  it.each([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
  ])("accepts %s", (type) => {
    expect(validateChatImage(makeFile(type))).toBeNull();
  });

  it("accepts a HEIC file whose type the browser left empty", () => {
    expect(validateChatImage(makeFile("", 100, "IMG_0001.HEIC"))).toBeNull();
    expect(validateChatImage(makeFile("", 100, "IMG_0002.heif"))).toBeNull();
  });

  it("rejects other types", () => {
    expect(validateChatImage(makeFile("image/gif", 100, "a.gif"))).toMatch(
      /JPG, PNG, WebP or HEIC/,
    );
    expect(
      validateChatImage(makeFile("application/pdf", 100, "a.pdf")),
    ).not.toBeNull();
  });

  it("allows exactly 10 MB and rejects one byte more", () => {
    expect(
      validateChatImage(makeFile("image/png", MAX_CHAT_IMAGE_BYTES)),
    ).toBeNull();
    expect(
      validateChatImage(makeFile("image/png", MAX_CHAT_IMAGE_BYTES + 1)),
    ).toBe("Image must be at most 10 MB.");
  });
});

describe("useChatImageUpload", () => {
  it("starts idle", () => {
    const { result } = renderHook(() => useChatImageUpload("ws1"));

    expect(result.current.state).toEqual({ status: "idle" });
  });

  it("rejects an oversized file without any request", async () => {
    const { result } = renderHook(() => useChatImageUpload("ws1"));

    let url: string | null = "unset";
    await act(async () => {
      url = await result.current.upload(
        makeFile("image/png", MAX_CHAT_IMAGE_BYTES + 1),
      );
    });

    expect(url).toBeNull();
    expect(result.current.state).toEqual({
      status: "error",
      message: "Image must be at most 10 MB.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks the API for a signature scoped to the workspace", async () => {
    const { result } = renderHook(() => useChatImageUpload("ws 1"));

    await act(async () => {
      void result.current.upload(makeFile());
    });
    await settle();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/api/upload/chat-image-signature?workspaceId=ws%201",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("posts the exact signed field set to Cloudinary", async () => {
    const { result } = renderHook(() => useChatImageUpload("ws1"));
    const file = makeFile("image/heic", 2048, "IMG_1.heic");

    await act(async () => {
      void result.current.upload(file);
    });
    await settle();

    const xhr = FakeXHR.instances[0]!;
    expect(xhr.method).toBe("POST");
    expect(xhr.url).toBe(
      "https://api.cloudinary.com/v1_1/test-cloud/image/upload",
    );
    const sent: Record<string, FormDataEntryValue> = {};
    for (const [k, v] of xhr.body!.entries()) sent[k] = v;
    expect(Object.keys(sent).sort()).toEqual(
      [
        "allowed_formats",
        "api_key",
        "context",
        "file",
        "folder",
        "public_id",
        "signature",
        "timestamp",
        "transformation",
      ].sort(),
    );
    expect(sent).toMatchObject({
      api_key: "key-1",
      timestamp: "1700000000",
      signature: "sig-1",
      folder: "nimbus/chat/ws1",
      public_id: "ckpublicid",
      allowed_formats: "jpg,png,webp,heic",
      transformation: "c_limit,w_2048,h_2048",
      context: "uploader=u1",
    });
  });

  it("reports progress, then resolves with the secure_url", async () => {
    const { result } = renderHook(() => useChatImageUpload("ws1"));

    let promise!: Promise<string | null>;
    await act(async () => {
      promise = result.current.upload(makeFile());
    });
    await settle();
    expect(result.current.state).toMatchObject({
      status: "uploading",
      progress: 0,
    });

    act(() => FakeXHR.instances[0]!.progress(50, 100));
    expect(result.current.state).toMatchObject({
      status: "uploading",
      progress: 50,
    });

    // Never reports 100% until the response arrives.
    act(() => FakeXHR.instances[0]!.progress(100, 100));
    expect(result.current.state).toMatchObject({ progress: 99 });

    act(() => FakeXHR.instances[0]!.finish(200, { secure_url: SECURE_URL }));
    await act(async () => {
      await expect(promise).resolves.toBe(SECURE_URL);
    });
    expect(result.current.state).toEqual({
      status: "ready",
      imageUrl: SECURE_URL,
      previewUrl: "blob:preview",
    });
  });

  it("ignores progress events that carry no length", async () => {
    const { result } = renderHook(() => useChatImageUpload("ws1"));
    await act(async () => {
      void result.current.upload(makeFile());
    });
    await settle();

    act(() =>
      FakeXHR.instances[0]!.upload.onprogress?.({ lengthComputable: false }),
    );

    expect(result.current.state).toMatchObject({ progress: 0 });
  });

  it("cancels an upload in flight: aborts the request and returns to idle", async () => {
    const { result } = renderHook(() => useChatImageUpload("ws1"));
    let promise!: Promise<string | null>;
    await act(async () => {
      promise = result.current.upload(makeFile());
    });
    await settle();

    act(() => result.current.cancel());

    await expect(promise).resolves.toBeNull();
    expect(FakeXHR.instances[0]!.aborted).toBe(true);
    expect(result.current.state).toEqual({ status: "idle" });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
  });

  it("cancels during the signature fetch without reporting an error", async () => {
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const { result } = renderHook(() => useChatImageUpload("ws1"));
    let promise!: Promise<string | null>;
    await act(async () => {
      promise = result.current.upload(makeFile());
    });

    act(() => result.current.cancel());

    await expect(promise).resolves.toBeNull();
    expect(FakeXHR.instances).toHaveLength(0);
    expect(result.current.state).toEqual({ status: "idle" });
  });

  it("surfaces the API's message when the signature is refused", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ success: false, message: "Workspace not found" }),
        { status: 404 },
      ),
    );
    const { result } = renderHook(() => useChatImageUpload("ws1"));

    await act(async () => {
      await result.current.upload(makeFile());
    });

    expect(result.current.state).toEqual({
      status: "error",
      message: "Workspace not found",
    });
  });

  it("reports a network failure fetching the signature", async () => {
    fetchMock.mockRejectedValue(new TypeError("offline"));
    const { result } = renderHook(() => useChatImageUpload("ws1"));

    await act(async () => {
      await result.current.upload(makeFile());
    });

    expect(result.current.state).toEqual({
      status: "error",
      message: "Could not start the upload.",
    });
  });

  it("shows Cloudinary's own message when it rejects the upload", async () => {
    const { result } = renderHook(() => useChatImageUpload("ws1"));
    let promise!: Promise<string | null>;
    await act(async () => {
      promise = result.current.upload(makeFile());
    });
    await settle();

    act(() =>
      FakeXHR.instances[0]!.finish(400, {
        error: { message: "Invalid image file" },
      }),
    );

    await expect(promise).resolves.toBeNull();
    expect(result.current.state).toEqual({
      status: "error",
      message: "Invalid image file",
    });
  });

  it("falls back to a generic message for an unreadable Cloudinary reply", async () => {
    const { result } = renderHook(() => useChatImageUpload("ws1"));
    await act(async () => {
      void result.current.upload(makeFile());
    });
    await settle();

    act(() => FakeXHR.instances[0]!.finish(502, "<html>bad gateway</html>"));

    expect(result.current.state).toEqual({
      status: "error",
      message: "The image could not be uploaded.",
    });
  });

  it("reports a transport error during the upload", async () => {
    const { result } = renderHook(() => useChatImageUpload("ws1"));
    await act(async () => {
      void result.current.upload(makeFile());
    });
    await settle();

    act(() => FakeXHR.instances[0]!.onerror?.());

    expect(result.current.state).toEqual({
      status: "error",
      message: "The image could not be uploaded.",
    });
  });

  it("a second upload replaces the first", async () => {
    const { result } = renderHook(() => useChatImageUpload("ws1"));
    await act(async () => {
      void result.current.upload(makeFile());
    });
    await settle();

    await act(async () => {
      void result.current.upload(makeFile("image/jpeg", 10, "b.jpg"));
    });
    await settle();

    expect(FakeXHR.instances[0]!.aborted).toBe(true);
    expect(FakeXHR.instances).toHaveLength(2);
  });

  it("aborts an upload in flight when the component unmounts", async () => {
    const { result, unmount } = renderHook(() => useChatImageUpload("ws1"));
    await act(async () => {
      void result.current.upload(makeFile());
    });
    await settle();

    unmount();

    expect(FakeXHR.instances[0]!.aborted).toBe(true);
  });
});
