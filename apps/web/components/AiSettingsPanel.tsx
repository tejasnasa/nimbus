"use client";

/**
 * @module web/components/AiSettingsPanel
 * @description Account-settings "AI" tab body: free-tier summary line,
 * credential list with masked previews, add/replace/remove, and a per-feature
 * provider/model picker.
 *
 * `@important` Dialog open-state lives at the panel level — not inside a row —
 * because {@link SettingTabs} unmounts inactive panels, so dialog state owned
 * inside a row would be lost on tab switch.
 *
 * `SettingTabs` also remounts this panel on every visit, so the hooks'
 * auto-fetch on mount runs again. That is the deliberate property already
 * documented for `Sessions`; do not "fix" it.
 */
import Button from "@nimbus/ui/Button";
import Delete from "@nimbus/ui/icons/Delete";
import Error from "@nimbus/ui/icons/Error";
import Plus from "@nimbus/ui/icons/Plus";
import { useState } from "react";
import {
  AI_PROVIDERS,
  type AiCredentialDTO,
  type AiFeature,
  type AiProviderId,
  type AiStatusDTO,
} from "@nimbus/types";
import AiRefusalBanner from "./AiRefusalBanner";
import AiModelPicker from "./AiModelPicker";
import ApiKeyDialog from "./ApiKeyDialog";
import { useAiCredentials } from "../hooks/useAiCredentials";
import { useAiPreferences } from "../hooks/useAiPreferences";
import { useAiStatus } from "../hooks/useAiStatus";

type Props = {
  /** Initial status payload so the panel renders without waiting for a fetch. */
  initialStatus: AiStatusDTO;
};

const FEATURE_LABELS: Record<AiFeature, string> = {
  chat: "Chat replies",
  markdown: "Markdown documents",
  canvas: "Canvas diagrams",
};

/**
 * Renders the AI settings tab. Owns the {@link ApiKeyDialog} open state.
 *
 * @param props.initialStatus - Server-seeded status payload so the panel is
 *                              answerable on first render.
 */
export default function AiSettingsPanel({ initialStatus }: Props) {
  const { state: statusState, refresh: refreshStatus } = useAiStatus();
  const {
    state: credentialsState,
    save: saveCredential,
    remove: removeCredential,
    refresh: refreshCredentials,
  } = useAiCredentials();
  const {
    state: preferencesState,
    pending,
    error: preferencesError,
    save: savePreference,
    refresh: refreshPreferences,
  } = useAiPreferences();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogInitialProvider, setDialogInitialProvider] = useState<
    AiProviderId | undefined
  >(undefined);
  const [removingProviderId, setRemovingProviderId] =
    useState<AiProviderId | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  // Prefer the freshly-fetched payload; fall back to the seed so the panel
  // renders meaningful content before the first fetch lands.
  const status =
    statusState.kind === "ready" ? statusState.status : initialStatus;

  const handleAddKey = () => {
    setDialogInitialProvider(undefined);
    setDialogOpen(true);
  };

  const handleReplaceKey = (providerId: AiProviderId) => {
    setDialogInitialProvider(providerId);
    setDialogOpen(true);
  };

  const handleDialogSave = async (input: {
    providerId: AiProviderId;
    apiKey: string;
    label?: string;
  }) => {
    const result = await saveCredential(input);
    if (result.ok) {
      // Status payload carries the credential row + the (possibly reset)
      // capabilities. Refetch everything that depends on it.
      await Promise.all([refreshStatus(), refreshPreferences()]);
    }
    return result.ok
      ? { ok: true as const }
      : { ok: false as const, message: result.message };
  };

  const handleRemoveKey = async (providerId: AiProviderId) => {
    setRemovingProviderId(providerId);
    setRemoveError(null);
    try {
      const result = await removeCredential(providerId);
      if (result.ok) {
        await Promise.all([refreshStatus(), refreshPreferences()]);
      } else {
        setRemoveError(result.message);
      }
    } catch (err) {
      setRemoveError(
        (err as { message?: string }).message ??
          "Could not remove the credential. Please try again.",
      );
    } finally {
      setRemovingProviderId(null);
    }
  };

  const handleChangeProvider = async (
    feature: AiFeature,
    providerId: AiProviderId,
  ) => {
    const providerSpec = AI_PROVIDERS[providerId];
    const modelId = providerSpec.defaultModel;
    await savePreference({ feature, providerId, modelId });
  };

  const handleChangeModel = async (
    feature: AiFeature,
    providerId: string,
    modelId: string,
  ) => {
    await savePreference({
      feature,
      providerId: providerId as AiProviderId,
      modelId,
    });
  };

  // BYOK is unavailable when the API does not have an encryption key. The
  // entire add/replace surface is hidden, but the free-tier line stays visible
  // so the user can still see what they're entitled to.
  const byokAvailable = status.byokAvailable;
  const credentials: readonly AiCredentialDTO[] =
    credentialsState.kind === "ready"
      ? credentialsState.credentials
      : (status.credentials ?? []);
  const preferences =
    preferencesState.kind === "ready"
      ? preferencesState.preferences
      : status.preferences;

  const refreshAll = async () => {
    await Promise.all([
      refreshStatus(),
      refreshCredentials(),
      refreshPreferences(),
    ]);
  };

  return (
    <div
      className="space-y-6"
      aria-label="ai-settings-panel"
      data-testid="ai-settings-panel"
    >
      <p className="text-sm text-(--muted-foreground)">
        Manage your AI provider keys and per-feature model choices. Without a
        key, Nimbus uses the operator&apos;s free tier (
        {status.documents.freeLimit} document generations per account).
      </p>

      <FreeTierSummary
        freeRemaining={status.documents.freeRemaining}
        freeLimit={status.documents.freeLimit}
        freeTierState={status.documents.freeTierState}
      />

      {!byokAvailable && (
        <AiRefusalBanner
          message="Adding your own API key is not enabled on this deployment. The free tier is still available."
          cta="manage-ai"
          onCtaClickAction={refreshAll}
        />
      )}

      <section className="space-y-3">
        <header className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">API keys</h2>
          {byokAvailable && (
            <Button
              size="xs"
              data-testid="ai-add-key"
              onClick={handleAddKey}
              className="rounded-lg hover:cursor-pointer"
            >
              <Plus className="w-3 h-3 mr-1" />
              Add key
            </Button>
          )}
        </header>

        {credentials.length === 0 ? (
          <p className="text-xs text-(--muted-foreground)">
            No API keys saved. Add one to choose your own provider and model.
          </p>
        ) : (
          <ul className="space-y-2" data-testid="ai-credential-list">
            {credentials.map((c) => (
              <CredentialRow
                key={c.providerId}
                credential={c}
                disabled={!byokAvailable || removingProviderId === c.providerId}
                onReplace={() => handleReplaceKey(c.providerId as AiProviderId)}
                onRemove={() =>
                  void handleRemoveKey(c.providerId as AiProviderId)
                }
              />
            ))}
          </ul>
        )}

        {removeError && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-(--destructive)/10 border border-(--destructive)/20">
            <Error className="w-4 h-4 text-(--destructive) shrink-0" />
            <span className="text-xs text-(--destructive)">{removeError}</span>
          </div>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold">Per-feature model</h2>
        <p className="text-xs text-(--muted-foreground)">
          Changes save automatically. Models without the required capabilities
          for a feature are hidden.
        </p>

        <div className="space-y-5">
          {(Object.keys(FEATURE_LABELS) as AiFeature[]).map((feature) => (
            <div key={feature} className="space-y-2">
              <h3 className="text-xs font-medium text-(--muted-foreground)">
                {FEATURE_LABELS[feature]}
              </h3>
              <AiModelPicker
                feature={feature}
                credentials={credentials}
                preference={preferences[feature]}
                pending={pending === feature}
                // Show on the picker whose save just failed. The hook only
                // carries one error string at a time, so a successful save
                // for another picker clears it.
                error={
                  pending === feature || pending === null
                    ? preferencesError
                    : null
                }
                onChangeProviderAction={(providerId) =>
                  void handleChangeProvider(feature, providerId)
                }
                onChangeModelAction={(modelId) => {
                  const providerId =
                    preferences[feature]?.providerId ??
                    credentials[0]?.providerId;
                  if (!providerId) return;
                  void handleChangeModel(feature, providerId, modelId);
                }}
              />
            </div>
          ))}
        </div>
      </section>

      <ApiKeyDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSave={handleDialogSave}
        initialProvider={dialogInitialProvider}
      />
    </div>
  );
}

/** One row in the credential list, with masked preview + replace/remove. */
function CredentialRow({
  credential,
  disabled,
  onReplace,
  onRemove,
}: {
  credential: AiCredentialDTO;
  disabled: boolean;
  onReplace: () => void;
  onRemove: () => void;
}) {
  return (
    <li
      data-testid={`ai-credential-row-${credential.providerId}`}
      className="flex items-center justify-between gap-3 rounded-xl border border-(--border) bg-(--muted)/30 px-3 py-2"
    >
      <div className="flex flex-col min-w-0">
        <span className="text-sm font-medium truncate">
          {credential.label ?? credential.providerId}
        </span>
        <span className="text-xs text-(--muted-foreground) truncate font-mono">
          {credential.maskedPreview}
        </span>
      </div>
      <div className="flex gap-2 shrink-0">
        <Button
          size="xs"
          onClick={onReplace}
          disabled={disabled}
          data-testid={`ai-replace-credential-${credential.providerId}`}
          className="rounded-lg hover:cursor-pointer bg-transparent border border-(--border) text-(--foreground) hover:bg-(--muted)"
        >
          Replace
        </Button>
        <Button
          size="xs"
          onClick={onRemove}
          disabled={disabled}
          data-testid={`ai-remove-credential-${credential.providerId}`}
          className="rounded-lg hover:cursor-pointer bg-transparent border border-(--destructive)/40 text-(--destructive) hover:bg-(--destructive)/10"
          aria-label={`Remove API key for ${credential.providerId}`}
        >
          <Delete className="w-3 h-3" />
        </Button>
      </div>
    </li>
  );
}

/** The free-tier line: "X of Y document generations remaining" etc. */
function FreeTierSummary({
  freeRemaining,
  freeLimit,
  freeTierState,
}: {
  freeRemaining: number;
  freeLimit: number;
  freeTierState: "available" | "exhausted" | "unconfigured";
}) {
  let copy: string;
  let testId: string;
  if (freeTierState === "unconfigured") {
    copy = "The free tier is not configured on this deployment.";
    testId = "free-tier-unconfigured";
  } else if (freeTierState === "exhausted") {
    copy = `Free tier exhausted — you've used all ${freeLimit} document generations. Add your own API key to continue.`;
    testId = "free-tier-exhausted";
  } else {
    copy = `Free tier: ${freeRemaining} of ${freeLimit} document generations remaining.`;
    testId = "free-tier-available";
  }
  return (
    <div
      data-testid={testId}
      className="rounded-xl border border-(--border) bg-(--muted)/30 px-4 py-3"
    >
      <p className="text-xs text-(--muted-foreground)">{copy}</p>
    </div>
  );
}
