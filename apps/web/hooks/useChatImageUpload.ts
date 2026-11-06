/**
 * @module web/hooks/useChatImageUpload
 * @description Uploads one image for a chat message straight to Cloudinary:
 * validate → fetch a workspace-scoped signature from
 * `/api/upload/chat-image-signature` → POST the file with the exact signed
 * parameter set (over `XMLHttpRequest`, the only browser API that reports upload
 * progress) → expose the returned `secure_url` for `message:send`.
 *
 * @important The signature is time-boxed and signs the destination folder, so
 *            each upload fetches a fresh one and a signature for one workspace
 *            cannot place an image in another. The `imageUrl` handed to the
 *            caller is only ever Cloudinary's `secure_url`; the API re-checks it
 *            with `isOwnedChatImageUrl` before it accepts a message.
 *
 * @important `cancel()` aborts whichever stage is in flight and leaves the hook
 *            idle; a cancelled upload never reports an error.
 */
import { useCallback, useEffect, useRef, useState } from "react";

/** Largest file the composer accepts, in bytes. */
export const MAX_CHAT_IMAGE_BYTES = 10 * 1024 * 1024;

/** MIME types the picker and drop zone accept. */
export const CHAT_IMAGE_ACCEPT =
  "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif";

const ACCEPTED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
];

/** Where an upload is. */
export type ChatImageUploadState =
  | { status: "idle" }
  | { status: "uploading"; progress: number; previewUrl: string }
  | { status: "ready"; imageUrl: string; previewUrl: string }
  | { status: "error"; message: string };

type Signature = {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  folder: string;
  publicId: string;
  allowedFormats: string;
  transformation: string;
  context: string;
  signature: string;
};

/**
 * Checks a file against the composer's limits.
 *
 * HEIC is accepted by extension as well as by type, because several browsers
 * report an empty `type` for it.
 *
 * @returns A user-facing message, or `null` when the file is acceptable.
 */
export function validateChatImage(file: File): string | null {
  const heicByName = /\.(heic|heif)$/i.test(file.name);
  if (!ACCEPTED_TYPES.includes(file.type) && !heicByName) {
    return "Please choose a JPG, PNG, WebP or HEIC image.";
  }
  if (file.size > MAX_CHAT_IMAGE_BYTES) {
    return "Image must be at most 10 MB.";
  }
  return null;
}

/**
 * Chat image upload state and handlers for one workspace.
 *
 * @param workspaceId - Workspace the image will be posted in.
 * @returns The current state, `upload(file)` (resolves to the `secure_url`, or
 *          `null` on failure or cancellation), `cancel()` and `reset()`.
 */
export function useChatImageUpload(workspaceId: string) {
  const [state, setState] = useState<ChatImageUploadState>({ status: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const previewRef = useRef<string | null>(null);

  const revokePreview = useCallback(() => {
    if (previewRef.current) {
      URL.revokeObjectURL(previewRef.current);
      previewRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    xhrRef.current?.abort();
    xhrRef.current = null;
    revokePreview();
    setState({ status: "idle" });
  }, [revokePreview]);

  const reset = cancel;

  useEffect(
    () => () => {
      abortRef.current?.abort();
      xhrRef.current?.abort();
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    },
    [],
  );

  const upload = useCallback(
    async (file: File): Promise<string | null> => {
      const invalid = validateChatImage(file);
      if (invalid) {
        setState({ status: "error", message: invalid });
        return null;
      }

      abortRef.current?.abort();
      xhrRef.current?.abort();
      revokePreview();

      const controller = new AbortController();
      abortRef.current = controller;
      const previewUrl = URL.createObjectURL(file);
      previewRef.current = previewUrl;
      setState({ status: "uploading", progress: 0, previewUrl });

      const fail = (message: string) => {
        if (controller.signal.aborted) return null;
        revokePreview();
        setState({ status: "error", message });
        return null;
      };

      try {
        const sigRes = await fetch(
          `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/upload/chat-image-signature?workspaceId=${encodeURIComponent(workspaceId)}`,
          { credentials: "include", signal: controller.signal },
        );
        const body = (await sigRes.json().catch(() => null)) as {
          success?: boolean;
          message?: string;
          responseObject?: Signature;
        } | null;
        if (!sigRes.ok || !body?.success || !body.responseObject) {
          return fail(body?.message ?? "Could not start the upload.");
        }
        const sig = body.responseObject;

        const form = new FormData();
        form.append("file", file);
        form.append("api_key", sig.apiKey);
        form.append("timestamp", String(sig.timestamp));
        form.append("signature", sig.signature);
        form.append("folder", sig.folder);
        form.append("public_id", sig.publicId);
        form.append("allowed_formats", sig.allowedFormats);
        form.append("transformation", sig.transformation);
        form.append("context", sig.context);

        const secureUrl = await new Promise<string | null>((resolve) => {
          const xhr = new XMLHttpRequest();
          xhrRef.current = xhr;
          xhr.open(
            "POST",
            `https://api.cloudinary.com/v1_1/${sig.cloudName}/image/upload`,
          );
          xhr.upload.onprogress = (e) => {
            if (!e.lengthComputable) return;
            setState((prev) =>
              prev.status === "uploading"
                ? {
                    ...prev,
                    progress: Math.min(
                      99,
                      Math.round((e.loaded / e.total) * 100),
                    ),
                  }
                : prev,
            );
          };
          xhr.onload = () => {
            let parsed: { secure_url?: string; error?: { message?: string } } =
              {};
            try {
              parsed = JSON.parse(xhr.responseText);
            } catch {
              // Handled by the missing secure_url below.
            }
            if (xhr.status >= 200 && xhr.status < 300 && parsed.secure_url) {
              resolve(parsed.secure_url);
            } else {
              fail(parsed.error?.message ?? "The image could not be uploaded.");
              resolve(null);
            }
          };
          xhr.onerror = () => {
            fail("The image could not be uploaded.");
            resolve(null);
          };
          xhr.onabort = () => resolve(null);
          xhr.send(form);
        });

        if (!secureUrl || controller.signal.aborted) return null;
        setState({ status: "ready", imageUrl: secureUrl, previewUrl });
        return secureUrl;
      } catch {
        return fail("Could not start the upload.");
      } finally {
        // A newer upload may already own the slot.
        if (abortRef.current === controller) xhrRef.current = null;
      }
    },
    [revokePreview, workspaceId],
  );

  return { state, upload, cancel, reset };
}
