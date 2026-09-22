/**
 * @module web/tests/unit/hooks/useAvatarUpload
 * @description Avatar-upload happy/sad paths: client-side validation,
 * the signature fetch, the exact signed parameter set posted to Cloudinary,
 * and the persistence of the returned `secure_url` on the user.
 *
 * Two surfaces are mocked:
 *  - `global.fetch` for the signature fetch and the Cloudinary upload;
 *  - `authClient.updateUser` for the persistence call.
 *
 * No real network or Cloudinary key is needed. The MSW default handlers are
 * active too but are only consulted when `fetch` falls through, which the
 * hook never lets happen for the avatar pipeline.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authClient } from "../../../lib/auth-client";

const { routerMock } = vi.hoisted(() => ({
  routerMock: { push: vi.fn(), refresh: vi.fn(), replace: vi.fn() },
}));

vi.mock("next/navigation", () => ({ useRouter: () => routerMock }));

const updateUserMock = vi.fn();
vi.mock("../../../lib/auth-client", () => ({
  authClient: {
    updateUser: (patch: unknown, opts?: unknown) => updateUserMock(patch, opts),
  },
}));

import { useAvatarUpload } from "../../../hooks/useAvatarUpload";

process.env.NEXT_PUBLIC_BACKEND_URL = "http://localhost:3001";

/** Builds a File from a typed array, which the browser's File constructor
 *  does as well — happy-dom accepts the same shape. */
const makeFile = (type: string, size: number, name = "avatar.png") =>
  new File([new Uint8Array(size)], name, { type });

/** Reads a FormData body as a plain object for assertion-friendly output. */
const formToObject = (form: FormData) => {
  const out: Record<string, string> = {};
  for (const [k, v] of form.entries()) {
    out[k] = typeof v === "string" ? v : "[binary]";
  }
  return out;
};

const SIG = {
  cloudName: "test-cloud",
  apiKey: "test-api-key",
  timestamp: 1700000000,
  publicId: "nimbus/avatars/user-1",
  format: "jpg",
  signature: "deadbeef",
};

const SECURE_URL =
  "https://res.cloudinary.com/test-cloud/image/upload/v1/avatar.jpg";

describe("useAvatarUpload", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    routerMock.refresh.mockClear();
    updateUserMock.mockReset();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects a non-image file before any network call", async () => {
    const { result } = renderHook(() => useAvatarUpload());

    await act(async () => {
      try {
        await result.current.upload(makeFile("application/pdf", 1024));
      } catch {
        // expected
      }
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/JPG, PNG/);
  });

  it("rejects an oversized file before any network call", async () => {
    const { result } = renderHook(() => useAvatarUpload());

    await act(async () => {
      try {
        await result.current.upload(makeFile("image/png", 3 * 1024 * 1024));
      } catch {
        // expected
      }
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/2 MB/);
  });

  it("fetches the signature, posts the exact signed field set, and saves the secure_url", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            message: "OK",
            responseObject: SIG,
            statusCode: 200,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ secure_url: SECURE_URL }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    updateUserMock.mockImplementation(
      (_patch: unknown, opts?: { onSuccess?: () => void }) => {
        opts?.onSuccess?.();
        return Promise.resolve();
      },
    );

    const { result } = renderHook(() => useAvatarUpload());

    let saved: string | undefined;
    await act(async () => {
      saved = await result.current.upload(makeFile("image/png", 1024));
    });

    expect(saved).toBe(SECURE_URL);

    // 1. The signature fetch hit the documented endpoint with credentials.
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/upload/avatar-signature`,
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      credentials: "include",
    });

    // 2. The Cloudinary POST was to the correct URL and carried exactly the
    //    signed parameter set.
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      `https://api.cloudinary.com/v1_1/${SIG.cloudName}/image/upload`,
    );
    const form = fetchMock.mock.calls[1]?.[1]?.body as FormData;
    expect(formToObject(form)).toEqual({
      file: "[binary]",
      api_key: SIG.apiKey,
      timestamp: String(SIG.timestamp),
      signature: SIG.signature,
      public_id: SIG.publicId,
      overwrite: "true",
      invalidate: "true",
      format: SIG.format,
    });

    // 3. The persistence call forwarded the secure_url, and the route was
    //    refreshed so the navbar reflects the new avatar without a reload.
    expect(updateUserMock).toHaveBeenCalledWith(
      { image: SECURE_URL },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
    expect(routerMock.refresh).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
  });

  it("surfaces the envelope error when the signature fetch fails", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: false,
          message: "Cloudinary is down",
          responseObject: null,
          statusCode: 503,
        }),
        { status: 503, headers: { "content-type": "application/json" } },
      ),
    );

    const { result } = renderHook(() => useAvatarUpload());

    await act(async () => {
      try {
        await result.current.upload(makeFile("image/png", 1024));
      } catch {
        // expected
      }
    });

    expect(result.current.error).toBe("Cloudinary is down");
    // updateUser is never called when the signature failed.
    expect(updateUserMock).not.toHaveBeenCalled();
    expect(routerMock.refresh).not.toHaveBeenCalled();
  });

  it("surfaces the message when the Cloudinary upload itself rejects the file", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            message: "OK",
            responseObject: SIG,
            statusCode: 200,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message:
                'Request forbidden due to missing permissions (actions=["create"])',
            },
          }),
          { status: 403 },
        ),
      );

    const { result } = renderHook(() => useAvatarUpload());

    await act(async () => {
      try {
        await result.current.upload(makeFile("image/png", 1024));
      } catch {
        // expected
      }
    });

    // Cloudinary's actual error message must reach the user verbatim, not
    // be masked as a generic rejection — a misconfigured API key is the
    // exact case this needs to surface.
    expect(result.current.error).toBe(
      'Request forbidden due to missing permissions (actions=["create"])',
    );
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("remove() calls updateUser with image: null and refreshes", async () => {
    updateUserMock.mockResolvedValue(undefined);

    const { result } = renderHook(() => useAvatarUpload());

    await act(async () => {
      await result.current.remove();
    });

    expect(updateUserMock).toHaveBeenCalledWith(
      { image: null },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
    expect(routerMock.refresh).toHaveBeenCalledTimes(1);
  });
});

// Silence the unused-import warning that would otherwise trip strict lint
// when only `authClient` is referenced through the mock factory.
void authClient;
