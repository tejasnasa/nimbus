/**
 * @module web/tests/unit/hooks/useContactForm
 * @description Contact-form behaviour: Zod validation surfaced through
 * `firstError`, the POST to `/api/contact` including the honeypot field, the
 * `sent` flag the form swaps itself on, and server failures landing on the root
 * error.
 *
 * The honeypot assertion is the load-bearing one: a request that omitted
 * `nimbus_hp` would still pass every other test here while leaving the server's
 * only abuse control inert.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse, type DefaultBodyType } from "msw";
import type { ChangeEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { BACKEND_URL, fail } from "../../msw/handlers";
import { server } from "../../msw/server";
import { useContactForm } from "../../../hooks/useContactForm";

process.env.NEXT_PUBLIC_BACKEND_URL = BACKEND_URL;

const CONTACT_URL = `${BACKEND_URL}/api/contact`;

/** Minimal change-event stand-in, so fields can be driven without a DOM input. */
const change = (name: string, value: string) =>
  ({ target: { name, value } }) as unknown as ChangeEvent<HTMLInputElement>;

type Form = ReturnType<typeof useContactForm>;

/** Fills every field with a valid submission. */
const fill = (
  result: { current: Form },
  {
    overrides = {},
    withCategory = true,
  }: { overrides?: Partial<Record<string, string>>; withCategory?: boolean } = {},
) => {
  act(() => {
    if (withCategory) result.current.setValue("category", "bug");
    result.current.register("name").onChange(change("name", "Ada Lovelace"));
    result.current
      .register("email")
      .onChange(change("email", "ada@example.com"));
    result.current
      .register("message")
      .onChange(change("message", "The canvas drops my last stroke on reload."));
  });

  for (const [field, value] of Object.entries(overrides)) {
    act(() => {
      result.current
        .register(field as "message")
        .onChange(change(field, value as string));
    });
  }
};

/** Records the bodies posted to the contact endpoint. */
const recordPosts = () => {
  const bodies: unknown[] = [];
  server.use(
    http.post(CONTACT_URL, async ({ request }) => {
      bodies.push(await request.json());
      return HttpResponse.json({
        success: true,
        message: "Message sent",
        responseObject: null,
        statusCode: 200,
      });
    }),
  );
  return bodies;
};

describe("useContactForm", () => {
  it("starts empty, unsent, and with no error", () => {
    const { result } = renderHook(() => useContactForm());

    expect(result.current.firstError).toBeUndefined();
    expect(result.current.sent).toBe(false);
    expect(result.current.isSubmitting).toBe(false);
    expect(result.current.watch("name")).toBe("");
  });

  it("prefills name and email from the session values", () => {
    const { result } = renderHook(() =>
      useContactForm({ name: "Ada Lovelace", email: "ada@example.com" }),
    );

    expect(result.current.watch("name")).toBe("Ada Lovelace");
    expect(result.current.watch("email")).toBe("ada@example.com");
  });

  it("requires a category without calling the API", async () => {
    const bodies = recordPosts();
    const { result } = renderHook(() => useContactForm());
    fill(result, { withCategory: false });

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(bodies).toHaveLength(0);
    expect(result.current.firstError).toBe("Choose a category.");
    expect(result.current.sent).toBe(false);
  });

  it("rejects a message below the minimum length without calling the API", async () => {
    const bodies = recordPosts();
    const { result } = renderHook(() => useContactForm());
    fill(result, { overrides: { message: "too short" } });

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(bodies).toHaveLength(0);
    expect(result.current.firstError).toBe(
      "Message must be at least 10 characters.",
    );
  });

  it("rejects a message beyond the maximum length", async () => {
    const bodies = recordPosts();
    const { result } = renderHook(() => useContactForm());
    fill(result, { overrides: { message: "x".repeat(5001) } });

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(bodies).toHaveLength(0);
    expect(result.current.firstError).toBe(
      "Message must be at most 5000 characters.",
    );
  });

  it("posts every field, honeypot included, and marks the form sent", async () => {
    const bodies = recordPosts();
    const { result } = renderHook(() => useContactForm());
    fill(result);

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toEqual({
      category: "bug",
      name: "Ada Lovelace",
      email: "ada@example.com",
      message: "The canvas drops my last stroke on reload.",
      nimbus_hp: "",
    });
    expect(result.current.sent).toBe(true);
    expect(result.current.firstError).toBeUndefined();
  });

  it("surfaces the envelope message as the root error when the API rejects", async () => {
    server.use(
      http.post(CONTACT_URL, () =>
        fail(502, "Could not send your message. Please try again."),
      ),
    );
    const { result } = renderHook(() => useContactForm());
    fill(result);

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(result.current.sent).toBe(false);
    expect(result.current.firstError).toBe(
      "Could not send your message. Please try again.",
    );
  });

  it("falls back to a generic message when the failure carries none", async () => {
    // A rejection with no `message` — what a transport failure often looks
    // like — must not surface an empty banner. Same shape as the
    // create-workspace hook's equivalent case.
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue({} as never);

    try {
      const { result } = renderHook(() => useContactForm());
      fill(result);

      await act(async () => {
        await result.current.onSubmit();
      });

      expect(result.current.sent).toBe(false);
      expect(result.current.firstError).toBe(
        "Something went wrong. Please try again.",
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("reports isSubmitting while the request is in flight", async () => {
    let release: (() => void) | undefined;
    server.use(
      http.post(
        CONTACT_URL,
        () =>
          new Promise<HttpResponse<DefaultBodyType>>((resolve) => {
            release = () =>
              resolve(
                HttpResponse.json({
                  success: true,
                  message: "Message sent",
                  responseObject: null,
                  statusCode: 200,
                }),
              );
          }),
      ),
    );

    const { result } = renderHook(() => useContactForm());
    fill(result);

    let submit: Promise<void>;
    await act(async () => {
      submit = result.current.onSubmit();
    });

    await waitFor(() => expect(result.current.isSubmitting).toBe(true));

    await act(async () => {
      release?.();
      await submit;
    });

    expect(result.current.isSubmitting).toBe(false);
    expect(result.current.sent).toBe(true);
  });

  it("clears the message but keeps the prefill when sending another", async () => {
    recordPosts();
    const { result } = renderHook(() =>
      useContactForm({ name: "Ada Lovelace", email: "ada@example.com" }),
    );
    fill(result);

    await act(async () => {
      await result.current.onSubmit();
    });
    expect(result.current.sent).toBe(true);

    act(() => {
      result.current.sendAnother();
    });

    expect(result.current.sent).toBe(false);
    expect(result.current.watch("message")).toBe("");
    expect(result.current.watch("category")).toBeUndefined();
    // The session values survive, so the second message is not retyped.
    expect(result.current.watch("name")).toBe("Ada Lovelace");
    expect(result.current.watch("email")).toBe("ada@example.com");
  });
});
