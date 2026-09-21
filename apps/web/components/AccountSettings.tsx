/**
 * @module web/components/AccountSettings
 * @description Account-level settings page shell: vertical `SettingTabs`.
 * The Profile tab is wired up (name + avatar); the remaining
 * three tabs render a placeholder identifying the phase that lands them.
 *
 * Each tab is its own panel; switching tabs unmounts inactive panels (see
 * `SettingTabs.tsx:33`), so per-tab form state resets on visit.
 */
"use client";

import Avatar from "@nimbus/ui/Avatar";
import Button from "@nimbus/ui/Button";
import Edit from "@nimbus/ui/icons/Edit";
import Error from "@nimbus/ui/icons/Error";
import Input from "@nimbus/ui/Input";
import SettingTabs from "@nimbus/ui/SettingTabs";
import { getAvatarForUser } from "@nimbus/ui/utils/getAvatarForUser";
import { useRef } from "react";
import { useAvatarUpload } from "../hooks/useAvatarUpload";
import { useProfileForm } from "../hooks/useProfileForm";

/** The session-shaped user the profile form is seeded from. */
type SessionUser = {
  id: string;
  name: string;
  image?: string | null;
};

/**
 * Account settings shell: renders the four-tab layout.
 *
 * @param props.user - The current session user. Only the Profile tab
 *                     consumes it today; the remaining tabs render
 *                     placeholders until later phases land.
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
            content: (
              <div className="space-y-4">
                <p className="text-sm text-(--muted-foreground)">
                  Change the password that backs this account.
                </p>
              </div>
            ),
          },
          {
            label: "Sessions",
            content: (
              <div className="space-y-4">
                <p className="text-sm text-(--muted-foreground)">
                  Devices currently signed in to your account.
                </p>
              </div>
            ),
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
