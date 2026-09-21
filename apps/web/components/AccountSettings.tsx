/**
 * @module web/components/AccountSettings
 * @description Account-level settings page shell: vertical `SettingTabs`.
 * Profile and Password tabs are wired up; the remaining two tabs
 * render placeholders until later work lands them.
 *
 * Each tab is its own panel; switching tabs unmounts inactive panels (see
 * `SettingTabs.tsx:33`), so per-tab form state resets on visit.
 */
"use client";

import Avatar from "@nimbus/ui/Avatar";
import Button from "@nimbus/ui/Button";
import Clock from "@nimbus/ui/icons/Clock";
import Delete from "@nimbus/ui/icons/Delete";
import Edit from "@nimbus/ui/icons/Edit";
import Error from "@nimbus/ui/icons/Error";
import Input from "@nimbus/ui/Input";
import SettingTabs from "@nimbus/ui/SettingTabs";
import { getAvatarForUser } from "@nimbus/ui/utils/getAvatarForUser";
import { useRef } from "react";
import { describeUserAgent } from "../lib/parseUserAgent";
import { useActiveSessions } from "../hooks/useActiveSessions";
import { useAvatarUpload } from "../hooks/useAvatarUpload";
import { useChangePasswordForm } from "../hooks/useChangePasswordForm";
import { useProfileForm } from "../hooks/useProfileForm";

/** The session-shaped user the profile form is seeded from. */
type SessionUser = {
  id: string;
  name: string;
  email: string;
  image?: string | null;
};

/**
 * Account settings shell: renders the four-tab layout.
 *
 * @param props.user - The current session user. The Profile tab seeds
 *                     name + image from it; the Password tab uses `email`
 *                     for the Google-only reset branch.
 */
export default function AccountSettings({ user }: { user: SessionUser }) {
  return (
    <div className="rounded-2xl p-2 shadow-2xl shadow-(--primary)/10 min-h-100">
      <SettingTabs
        tabs={[
          {
            label: "Profile",
            content: <ProfilePanel user={user} />,
          },
          {
            label: "Password",
            content: <ChangePasswordPanel email={user.email} />,
          },
          {
            label: "Sessions",
            content: <ActiveSessionsPanel />,
          },
          {
            label: "Danger Zone",
            content: (
              <div className="space-y-4">
                <p className="text-sm text-(--muted-foreground)">
                  Irreversible actions on your account.
                </p>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}

/**
 * Profile tab: editable name + avatar upload. Wraps `useProfileForm` and
 * `useAvatarUpload` and lays them out with the visual vocabulary shared
 * by the workspace settings (input + label pairing, error banner, dirty-gated
 * save button).
 */
function ProfilePanel({ user }: { user: SessionUser }) {
  const { register, firstError, isSubmitting, isDirty, onSubmit, setValue } =
    useProfileForm(user);
  const {
    upload,
    remove,
    uploading,
    error: uploadError,
    validate,
  } = useAvatarUpload();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const currentImage = user.image ?? null;
  const previewImage = currentImage ?? getAvatarForUser(user.id);

  /**
   * Handler for the hidden `<input type="file">`: validates, uploads, and
   * writes the returned `secure_url` into the profile form so a single
   * Save persists both name and avatar at once.
   */
  const handleFile = async (file: File) => {
    if (validate(file)) return; // validate() already populates `uploadError`
    try {
      const secureUrl = await upload(file);
      setValue("image", secureUrl, { shouldDirty: true });
    } catch {
      // upload()/validate() already set `uploadError`; the form stays clean.
    }
  };

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-6"
      aria-label="profile-settings-form"
    >
      <p className="text-sm text-(--muted-foreground)">
        Update your display name and avatar.
      </p>

      {/* Avatar preview + upload affordance. */}
      <div className="flex items-center gap-4">
        <Avatar
          user={{ name: user.name, image: previewImage }}
          classname="w-16 h-16"
        />
        <div className="flex flex-col gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            data-testid="avatar-file-input"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
              // Reset so the same file can be picked again after a
              // rejection (the browser suppresses identical selections
              // without this).
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            size="sm"
            loading={uploading}
            className="rounded-xl hover:cursor-pointer"
            onClick={() => fileInputRef.current?.click()}
          >
            <Edit className="w-4 h-4 mr-2" />
            Upload new avatar
          </Button>
          {currentImage && (
            <Button
              type="button"
              size="sm"
              loading={uploading}
              className="bg-transparent text-(--muted-foreground) hover:bg-(--muted) border border-(--border) rounded-xl"
              onClick={() => void remove()}
            >
              Remove avatar
            </Button>
          )}
        </div>
      </div>

      {uploadError && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-(--destructive)/10 border border-(--destructive)/20">
          <Error className="w-4 h-4 text-(--destructive) shrink-0" />
          <span className="text-xs text-(--destructive)">{uploadError}</span>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <label
          htmlFor="display-name"
          className="text-sm font-medium text-(--muted-foreground)"
        >
          Display name
        </label>
        <Input
          id="display-name"
          placeholder="Your name"
          className="w-full"
          {...register("name")}
        />
      </div>

      {firstError && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-(--destructive)/10 border border-(--destructive)/20">
          <Error className="w-4 h-4 text-(--destructive) shrink-0" />
          <span className="text-xs text-(--destructive)">{firstError}</span>
        </div>
      )}

      <div className="flex justify-end pt-2">
        <Button
          size="sm"
          className="hover:cursor-pointer rounded-xl"
          disabled={!isDirty || isSubmitting}
          loading={isSubmitting}
        >
          Save Changes
        </Button>
      </div>
    </form>
  );
}

/**
 * Password tab. Renders one of three shapes depending on the result of
 * `authClient.listAccounts()`:
 *
 * - **Loading**: a muted placeholder while the account probe is in flight.
 * - **Has-password**: the Current / New / Confirm form (`changePassword`)
 *   with a default-on `revokeOtherSessions` checkbox.
 * - **Google-only**: a single "Send me a set-password link" button
 *   (`requestPasswordReset`) — the credential account is created when the
 *   emailed reset link is followed, which is the linchpin of the
 *   Google-only reset flow.
 */
function ChangePasswordPanel({ email }: { email: string }) {
  const state = useChangePasswordForm(email);

  if (state.kind === "loading") {
    return (
      <div className="space-y-4" aria-busy="true">
        <p className="text-sm text-(--muted-foreground)">
          Checking your sign-in methods…
        </p>
        {state.loadError && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-(--destructive)/10 border border-(--destructive)/20">
            <Error className="w-4 h-4 text-(--destructive) shrink-0" />
            <span className="text-xs text-(--destructive)">
              {state.loadError}
            </span>
          </div>
        )}
      </div>
    );
  }

  if (state.kind === "google-only") {
    return <GoogleOnlyPasswordContent state={state} />;
  }

  return <WithPasswordContent state={state} />;
}

/** Change-password form for credential users. */
function WithPasswordContent({
  state,
}: {
  state: Extract<
    ReturnType<typeof useChangePasswordForm>,
    { kind: "with-password" }
  >;
}) {
  const { register, firstError, isSubmitting, onSubmit } = state;
  return (
    <form
      onSubmit={onSubmit}
      className="space-y-6"
      aria-label="change-password-form"
    >
      <p className="text-sm text-(--muted-foreground)">
        Change the password that backs this account.
      </p>

      <div className="flex flex-col gap-2">
        <label
          htmlFor="current-password"
          className="text-sm font-medium text-(--muted-foreground)"
        >
          Current password
        </label>
        <Input
          id="current-password"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          className="w-full"
          {...register("currentPassword")}
        />
      </div>

      <div className="flex flex-col gap-2">
        <label
          htmlFor="new-password"
          className="text-sm font-medium text-(--muted-foreground)"
        >
          New password
        </label>
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          placeholder="••••••••"
          className="w-full"
          {...register("newPassword")}
        />
      </div>

      <div className="flex flex-col gap-2">
        <label
          htmlFor="confirm-password"
          className="text-sm font-medium text-(--muted-foreground)"
        >
          Confirm new password
        </label>
        <Input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          placeholder="••••••••"
          className="w-full"
          {...register("confirmPassword")}
        />
      </div>

      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 rounded border-(--border) accent-(--primary) cursor-pointer"
          {...register("revokeOtherSessions")}
        />
        <span className="text-sm text-(--muted-foreground)">
          Sign out of all other devices where this account is signed in.
        </span>
      </label>

      {firstError && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-(--destructive)/10 border border-(--destructive)/20">
          <Error className="w-4 h-4 text-(--destructive) shrink-0" />
          <span className="text-xs text-(--destructive)">{firstError}</span>
        </div>
      )}

      <div className="flex justify-end pt-2">
        <Button
          type="submit"
          size="sm"
          className="hover:cursor-pointer rounded-xl"
          loading={isSubmitting}
        >
          Change password
        </Button>
      </div>
    </form>
  );
}

/** Single-button "Set a password" affordance for Google-only users. */
function GoogleOnlyPasswordContent({
  state,
}: {
  state: Extract<
    ReturnType<typeof useChangePasswordForm>,
    { kind: "google-only" }
  >;
}) {
  const { onSubmit, submitting, sent, error } = state;
  return (
    <div className="space-y-4">
      <p className="text-sm text-(--muted-foreground)">
        You signed in with Google, so this account has no password yet.
        We&rsquo;ll email you a link to set one.
      </p>

      <div className="flex justify-end pt-2">
        <Button
          type="button"
          size="sm"
          className="hover:cursor-pointer rounded-xl"
          onClick={() => void onSubmit()}
          loading={submitting}
          disabled={sent}
        >
          {sent ? "Link sent" : "Send me a set-password link"}
        </Button>
      </div>

      {sent && (
        <p
          className="text-xs text-(--muted-foreground)"
          aria-label="set-password-sent"
        >
          Check your inbox for the link. Following it will create a password for
          your account, after which you can change it from this tab.
        </p>
      )}

      {error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-(--destructive)/10 border border-(--destructive)/20">
          <Error className="w-4 h-4 text-(--destructive) shrink-0" />
          <span className="text-xs text-(--destructive)">{error}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Sessions tab. Renders one row per active device with a revoke button;
 * the current session is labelled and its revoke control is disabled
 * (revoking your own session from this list is a confusing way to sign
 * out, and there is a dedicated Sign Out for that). A bulk
 * "Sign out of all other devices" affordance sits at the bottom.
 *
 * Because `SettingTabs` unmounts inactive panels, the hook refetches
 * on every visit — a deliberate design property, not a bug.
 */
function ActiveSessionsPanel() {
  const { state, revokeSession, revokeOtherSessions, revoking } =
    useActiveSessions();

  if (state.kind === "loading") {
    return (
      <div className="space-y-4" aria-busy="true">
        <p className="text-sm text-(--muted-foreground)">
          Loading your active sessions…
        </p>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-(--destructive)/10 border border-(--destructive)/20">
          <Error className="w-4 h-4 text-(--destructive) shrink-0" />
          <span className="text-xs text-(--destructive)">{state.message}</span>
        </div>
      </div>
    );
  }

  const { sessions, currentToken } = state;
  const otherCount = sessions.filter((s) => s.token !== currentToken).length;

  return (
    <div className="space-y-6" aria-label="active-sessions">
      <p className="text-sm text-(--muted-foreground)">
        Devices currently signed in to your account.
      </p>

      <ul className="divide-y divide-(--border) rounded-xl border border-(--border)">
        {sessions.map((session) => {
          const isCurrent = session.token === currentToken;
          const isRevokingThis = revoking === session.token;
          return (
            <li
              key={session.token}
              className="flex items-center justify-between gap-4 px-4 py-3"
              data-testid="session-row"
              data-current={isCurrent ? "true" : undefined}
            >
              <div className="flex flex-col gap-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-(--foreground) truncate">
                    {describeUserAgent(session.userAgent)}
                  </span>
                  {isCurrent && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-(--primary)/15 text-(--primary)">
                      This device
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-(--muted-foreground)">
                  <span>{session.ipAddress ?? "Unknown IP"}</span>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    Active {formatRelativeTime(session.updatedAt)}
                  </span>
                </div>
              </div>
              <Button
                size="xs"
                type="button"
                className="bg-transparent text-(--muted-foreground) hover:bg-(--muted) border border-(--border) rounded-xl"
                onClick={() => void revokeSession(session.token)}
                loading={isRevokingThis}
                disabled={isCurrent || revoking !== null}
                aria-label={`Sign out of ${describeUserAgent(session.userAgent)}`}
              >
                <Delete className="w-3.5 h-3.5 mr-1" />
                Sign out
              </Button>
            </li>
          );
        })}
      </ul>

      {otherCount > 0 && (
        <div className="flex justify-end pt-2">
          <Button
            size="sm"
            type="button"
            className="hover:cursor-pointer rounded-xl"
            onClick={() => void revokeOtherSessions()}
            loading={revoking === "others"}
            disabled={revoking !== null && revoking !== "others"}
          >
            Sign out of all other devices
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Formats a date (ISO string or Date) as a coarse "5 minutes ago"-style
 * relative time. Returns "just now" for sub-minute deltas, "X
 * minutes/hours/days ago" up to a week, otherwise a short absolute date.
 */
function formatRelativeTime(input: Date | string): string {
  const then = typeof input === "string" ? new Date(input) : input;
  const diffMs = Date.now() - then.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return then.toLocaleDateString();
}
