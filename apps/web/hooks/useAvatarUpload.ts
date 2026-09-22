/**
 * @module web/hooks/useAvatarUpload
 * @description End-to-end avatar upload: validate → fetch a Cloudinary
 * signature from `/api/upload/avatar-signature` → POST the file to
 * Cloudinary with the exact signed parameter set → persist the returned
 * `secure_url` via `authClient.updateUser({ image })` → `router.refresh()`.
 *
 * @important The Cloudinary signature is **time-boxed** (1h). Each upload
 *            fetches a fresh one rather than caching — a cached signature
 *            can be replayed past its expiry and the upload is then
 *            rejected as a 401 from Cloudinary.
 *
 * @important `User.image` is *only* ever the `secure_url` from the upload
 *            response. Hand-building a delivery URL would skip the version
 *            segment and break the invalidation step.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "../lib/auth-client";

/** Client-side limits, mirroring Cloudinary's defaults. */
const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2 MB
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/**
 * Avatar-upload hook state and handlers.
 *
 * @param props.currentImage - The user's current `image` URL, surfaced in
 *                             the UI as a clearable preview.
 */
export function useAvatarUpload() {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Validates a file client-side. Returns an error string when the file
   * should be rejected without any network call.
   *
   * @param file - The file the user picked.
   */
  const validate = (file: File): string | null => {
    if (!(ACCEPTED_TYPES as readonly string[]).includes(file.type)) {
      return "Please choose a JPG, PNG, or WebP image.";
    }
    if (file.size > MAX_AVATAR_BYTES) {
      return "Image must be at most 2 MB.";
    }
    return null;
  };

  /**
   * Uploads a file to Cloudinary and persists the resulting URL as the
   * user's `image`. Returns the saved `secure_url` so callers can chain
   * (e.g. switch to a bundled avatar without re-fetching a signature).
   *
   * @param file - Validated image file.
   * @returns The persisted `secure_url`.
   */
  const upload = async (file: File): Promise<string> => {
    setError(null);
    const validationError = validate(file);
    if (validationError) {
      setError(validationError);
      throw new Error(validationError);
    }

    setUploading(true);
    try {
      // 1. Fetch a signature — Cloudinary rejects extra unsigned params,
      //    so the fields below MUST equal the signed set on the server.
      const sigRes = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/upload/avatar-signature`,
        { credentials: "include" },
      );
      if (!sigRes.ok) {
        const reason =
          (await sigRes.json().catch(() => null))?.message ??
          "Could not start the upload.";
        throw new Error(reason);
      }
      const {
        success: sigSuccess,
        responseObject: sig,
      }: {
        success: boolean;
        responseObject: {
          cloudName: string;
          apiKey: string;
          timestamp: number;
          publicId: string;
          format: string;
          signature: string;
        };
      } = await sigRes.json();

      if (!sigSuccess || !sig) {
        throw new Error("Could not start the upload.");
      }

      // 2. POST multipart to Cloudinary. The signed field set is exactly
      //    `public_id, timestamp, overwrite, invalidate, format`; `file`,
      //    `api_key`, `cloud_name` are not signed but still required.
      const form = new FormData();
      form.append("file", file);
      form.append("api_key", sig.apiKey);
      form.append("timestamp", String(sig.timestamp));
      form.append("signature", sig.signature);
      form.append("public_id", sig.publicId);
      form.append("overwrite", "true");
      form.append("invalidate", "true");
      form.append("format", sig.format);

      const uploadRes = await fetch(
        `https://api.cloudinary.com/v1_1/${sig.cloudName}/image/upload`,
        { method: "POST", body: form },
      );
      if (!uploadRes.ok) {
        // Cloudinary's error body is `{ error: { message } }` — surface it
        // verbatim rather than masking it as a generic "Cloudinary rejected
        // the upload." A misconfigured API key (e.g. one whose role lacks
        // the `create` action under the new Roles and Permissions model)
        // comes through here as a 403 with a specific message, which is
        // the only signal that points at the real cause.
        const reason =
          (await uploadRes.json().catch(() => null))?.error?.message ??
          "Cloudinary rejected the upload.";
        throw new Error(reason);
      }
      const body = (await uploadRes.json()) as { secure_url?: string };
      const secureUrl = body.secure_url;
      if (!secureUrl) {
        throw new Error("Cloudinary returned no URL.");
      }

      // 3. Persist the secure_url on the user row.
      await authClient.updateUser(
        { image: secureUrl },
        {
          onError: (ctx) => {
            throw new Error(
              ctx.error.message ?? "Failed to save the new avatar.",
            );
          },
        },
      );

      // 4. Re-render server components so the navbar reflects the new
      //    avatar immediately, without a hard reload.
      router.refresh();

      return secureUrl;
    } catch (err) {
      const message =
        (err as { message?: string }).message ??
        "Something went wrong. Please try again.";
      setError(message);
      throw err;
    } finally {
      setUploading(false);
    }
  };

  /**
   * Clears the user's avatar by sending `image: null` to `updateUser`. A
   * dedicated affordance — `User.image` has two provenances (Cloudinary
   * URL or Google profile URL), so the UI cannot assume a Cloudinary asset
   * exists.
   */
  const remove = async (): Promise<void> => {
    setError(null);
    setUploading(true);
    try {
      await authClient.updateUser(
        { image: null },
        {
          onError: (ctx) => {
            throw new Error(
              ctx.error.message ?? "Failed to remove the avatar.",
            );
          },
        },
      );
      router.refresh();
    } catch (err) {
      const message =
        (err as { message?: string }).message ??
        "Something went wrong. Please try again.";
      setError(message);
      throw err;
    } finally {
      setUploading(false);
    }
  };

  return { upload, remove, uploading, error, validate };
}
