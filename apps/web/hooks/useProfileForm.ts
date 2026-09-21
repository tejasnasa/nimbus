/**
 * @module web/hooks/useProfileForm
 * @description Profile (name + avatar URL) edit form, seeded from the session
 * user. Submits through `authClient.updateUser`, then `router.refresh()` so
 * server components (`/home` and `/settings` render `session.user.image`
 * into `UserNavbar`) re-read the new image.
 *
 * @important `updateUser` returns `{ status: true }`, **not the user**. The
 *            session cookie is re-set by better-auth and the client-side
 *            atom store is refreshed, but neither re-renders the server
 *            output — the navbar avatar stays stale until `router.refresh()`.
 *
 * @important `updateUser`'s body is `z.record(z.string(), z.any())` and the
 *            server throws `EMAIL_CAN_NOT_BE_UPDATED` if it contains
 *            `email`. We only forward name/image, never email.
 */
import { profileSchema } from "@nimbus/types";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { authClient } from "../lib/auth-client";

/**
 * Session-shaped user used to seed the form (the auth client returns a
 * superset, but the form only reads `name` + `image`).
 */
type SessionUser = {
  name: string;
  image?: string | null;
};

/**
 * @param user - Current session user. Name seeds the input, image is kept in
 *               form state but never submitted unless it changes.
 */
export function useProfileForm(user: SessionUser) {
  const router = useRouter();
  const form = useForm<z.infer<typeof profileSchema>>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      name: user.name,
      image: user.image ?? null,
    },
  });

  const { isDirty, isSubmitting, errors } = form.formState;
  const firstError =
    errors.name?.message || errors.image?.message || errors.root?.message;

  const onSubmit = form.handleSubmit(async ({ name, image }) => {
    // Build the patch: only include keys that actually changed.
    // `image` is forwarded only when it differs from the seed value, so a
    // pure name edit does not re-upload an unchanged avatar.
    const patch: { name?: string; image?: string | null } = {};
    if (name !== user.name) patch.name = name;
    if ((image ?? null) !== (user.image ?? null)) patch.image = image ?? null;

    // Nothing actually changed — the dirty gate should already prevent
    // this, but double-check so an accidental submission is a no-op.
    if (Object.keys(patch).length === 0) {
      form.reset({ name, image: image ?? null });
      return;
    }

    // better-auth resolves the promise even on an error response and only
    // signals failure through the `onError` callback. We track that with a
    // flag so the success path (reset + refresh) only runs when the call
    // actually succeeded.
    let succeeded = false;

    try {
      await authClient.updateUser(patch, {
        onSuccess: () => {
          succeeded = true;
        },
        onError: (ctx) => {
          form.setError("root", {
            message:
              ctx.error.message ?? "Something went wrong. Please try again.",
          });
        },
      });

      if (!succeeded) {
        // onError already populated the root message; do not reset the form
        // or refresh the route on a failed save.
        return;
      }

      form.reset({ name, image: image ?? null });
      // Re-render server components so the navbar reflects the new
      // name/image; better-auth refreshes the client atom store, but not
      // the server output.
      router.refresh();
    } catch (error) {
      form.setError("root", {
        message:
          (error as { message?: string }).message ??
          "Something went wrong. Please try again.",
      });
    }
  });

  return {
    register: form.register,
    setValue: form.setValue,
    firstError,
    isSubmitting,
    isDirty,
    onSubmit,
  };
}
