/**
 * @module web/components/AccountSettings
 * @description Account-level settings page shell: vertical `SettingTabs`.
 * Each tab is its own panel; switching tabs unmounts inactive
 * panels (see `SettingTabs.tsx:33`), so per-tab form state resets on visit.
 */
"use client";

import SettingTabs from "@nimbus/ui/SettingTabs";

/**
 * Account settings shell: renders the four-tab layout.
 */
export default function AccountSettings() {
  return (
    <div className="rounded-2xl p-2 shadow-2xl shadow-(--primary)/10 min-h-100">
      <SettingTabs
        tabs={[
          {
            label: "Profile",
            content: (
              <div className="space-y-4">
                <p className="text-sm text-(--muted-foreground)">
                  Update your display name and avatar.
                </p>
              </div>
            ),
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
