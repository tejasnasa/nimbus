"use client";

/**
 * @module web/components/WorkspaceAiPanel
 * @description The workspace settings "AI" tab. Keys, models, assistant
 * switches and the monthly spend cap belong to the workspace, so what the tab
 * shows depends on the viewer:
 *
 *   - **admins and owners** manage provider keys (with the model kinds each was
 *     verified for), choose a provider and model per feature (grouped as Chat
 *     and docs, Vision, Meetings and Voice), flip the assistant switches and
 *     set the spend cap, beside the month-to-date total;
 *   - **members** get a read-only summary of which AI features work in this
 *     workspace, and are told that keys are managed by workspace admins.
 *
 * The role comes from the server's status (`canManage`), never from a guess on
 * the client: a member who somehow rendered the admin view would only get 403s.
 *
 * @important Dialog open-state lives at the panel level, not inside a row,
 * because {@link SettingTabs} unmounts inactive panels, so dialog state owned
 * inside a row would be lost on tab switch. `SettingTabs` also remounts this
 * panel on every visit, so the hooks' auto-fetch on mount runs again. That is
 * the deliberate property already documented for `Sessions`; do not "fix" it.
 */
import Button from "@nimbus/ui/Button";
import Input from "@nimbus/ui/Input";
import Delete from "@nimbus/ui/icons/Delete";
import Error from "@nimbus/ui/icons/Error";
import Plus from "@nimbus/ui/icons/Plus";
import { useState } from "react";
import {
  AI_FEATURE_KIND,
  AI_PROVIDERS,
  defaultModelFor,
  modelsFor,
  type AiCredentialDTO,
  type AiFeature,
  type AiModelKind,
  type AiModelSource,
  type AiProviderId,
  type AiWorkspaceStatusDTO,
} from "@nimbus/types";
import AiModelPicker from "./AiModelPicker";
import ApiKeyDialog from "./ApiKeyDialog";
import { useWorkspaceAiCredentials } from "../hooks/useWorkspaceAiCredentials";
import {
  emptyPreferences,
  useWorkspaceAiPreferences,
} from "../hooks/useWorkspaceAiPreferences";
import { useWorkspaceAiSettings } from "../hooks/useWorkspaceAiSettings";
import type { UseWorkspaceAiStatus } from "../hooks/useWorkspaceAiStatus";

type Props = {
  /** The workspace cuid. */
  workspaceId: string;
  /** The status hook result, owned by the settings dialog so the tabs share it. */
  status: UseWorkspaceAiStatus;
};

/** Labels for the feature pickers, in the order the tab lists them. */
const FEATURES: ReadonlyArray<{ feature: AiFeature; label: string }> = [
  { feature: "chat", label: "Chat replies" },
  { feature: "markdown", label: "Markdown documents" },
  { feature: "canvas", label: "Canvas diagrams" },
  { feature: "vision", label: "Reading images" },
  { feature: "meeting", label: "Meeting notes and answers" },
  { feature: "transcription", label: "Transcription" },
  { feature: "speech", label: "Speech" },
];

const FEATURE_LABEL: Record<AiFeature, string> = Object.fromEntries(
  FEATURES.map((f) => [f.feature, f.label]),
) as Record<AiFeature, string>;

const KIND_LABEL: Record<AiModelKind, string> = {
  text: "Text",
  transcription: "Transcription",
  speech: "Speech",
};

/**
 * Renders the AI tab for the viewer's role.
 *
 * @param props.workspaceId - The workspace cuid.
 * @param props.status - The shared status hook result.
 */
export default function WorkspaceAiPanel({ workspaceId, status }: Props) {
  if (status.state.kind === "loading") {
    return (
      <p className="text-sm text-(--muted-foreground)" data-testid="ai-loading">
        Loading AI settings…
      </p>
    );
  }
  if (status.state.kind === "error") {
    return (
      <p
        role="alert"
        className="text-sm text-(--destructive)"
        data-testid="ai-error"
      >
        {status.state.message}
      </p>
    );
  }

  const dto = status.state.status;
  return dto.canManage ? (
    <AdminView
      workspaceId={workspaceId}
      status={dto}
      refresh={status.refresh}
    />
  ) : (
    <MemberView status={dto} />
  );
}

/** The read-only summary members see. */
function MemberView({ status }: { status: AiWorkspaceStatusDTO }) {
  const rows: Array<{ label: string; on: boolean; reason: string | null }> = [
    ...FEATURES.filter(
      ({ feature }) => AI_FEATURE_KIND[feature] === "text",
    ).map(({ feature, label }) => ({
      label,
      on: status.features[feature].enabled,
      reason: status.features[feature].reason,
    })),
    {
      label: "In-call assistant",
      on: status.voice.available,
      reason: status.voice.reason,
    },
  ];

  return (
    <div className="space-y-6" data-testid="ai-member-summary">
      <p className="text-sm text-(--muted-foreground)">
        AI features in this workspace use keys that workspace admins manage.
        Keys are managed by workspace admins, so ask one if something below is
        not available.
      </p>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li
            key={row.label}
            data-testid={`ai-summary-${row.label}`}
            className="flex items-center justify-between gap-3 rounded-xl border border-(--border) bg-(--muted)/30 px-3 py-2"
          >
            <span className="text-sm">{row.label}</span>
            <span
              className={`text-xs ${row.on ? "text-(--primary)" : "text-(--muted-foreground)"}`}
            >
              {row.on ? "Works here" : humanReason(row.reason)}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-(--muted-foreground)">
        Your free allowance: {status.free.docsRemaining} of{" "}
        {status.free.docsLimit} document generations and{" "}
        {Math.floor(status.free.voiceSecondsRemaining / 60)} of{" "}
        {Math.floor(status.free.voiceSecondsLimit / 60)} assistant minutes
        remaining.
      </p>
    </div>
  );
}

/** Short, curated wording for why a feature is off. */
function humanReason(reason: string | null): string {
  switch (reason) {
    case "spend-cap-reached":
      return "Monthly cap reached";
    case "assistant-disabled":
      return "Turned off";
    case "free-tier-exhausted":
    case "free-voice-exhausted":
      return "Free allowance used";
    case "no-capable-model":
      return "No capable model";
    default:
      return "Needs a key";
  }
}

/** The management view admins and owners see. */
function AdminView({
  workspaceId,
  status,
  refresh,
}: {
  workspaceId: string;
  status: AiWorkspaceStatusDTO;
  refresh: () => Promise<void>;
}) {
  const {
    state: credentialsState,
    save: saveCredential,
    remove: removeCredential,
  } = useWorkspaceAiCredentials(workspaceId, true);
  const {
    state: preferencesState,
    pending,
    error: preferencesError,
    save: savePreference,
    refresh: refreshPreferences,
  } = useWorkspaceAiPreferences(workspaceId);
  const settings = useWorkspaceAiSettings(workspaceId);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogInitialProvider, setDialogInitialProvider] = useState<
    AiProviderId | undefined
  >(undefined);
  const [removingProviderId, setRemovingProviderId] =
    useState<AiProviderId | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const credentials: readonly AiCredentialDTO[] =
    credentialsState.kind === "ready" ? credentialsState.credentials : [];
  const preferences =
    preferencesState.kind === "ready"
      ? preferencesState.preferences
      : emptyPreferences();

  const handleDialogSave = async (input: {
    providerId: AiProviderId;
    apiKey: string;
    label?: string;
  }) => {
    const result = await saveCredential(input);
    if (!result.ok) return { ok: false as const, message: result.message };
    setWarnings(result.warnings);
    // Saving can change which providers qualify for a feature.
    await Promise.all([refresh(), refreshPreferences()]);
    setDialogOpen(false);
    return { ok: true as const, warnings: result.warnings };
  };

  const handleRemoveKey = async (providerId: AiProviderId) => {
    setRemovingProviderId(providerId);
    setPanelError(null);
    setWarnings([]);
    const result = await removeCredential(providerId);
    if (result.ok) {
      await Promise.all([refresh(), refreshPreferences()]);
    } else {
      setPanelError(result.message);
    }
    setRemovingProviderId(null);
  };

  const handleChangeProvider = async (
    feature: AiFeature,
    providerId: AiProviderId,
  ) => {
    setPanelError(null);
    const provider = AI_PROVIDERS[providerId];
    const offered = modelsFor(provider, feature);
    const fallback = defaultModelFor(provider, AI_FEATURE_KIND[feature]);
    const model =
      offered.find((m) => m.id === fallback?.id) ?? offered[0] ?? null;
    if (!model) {
      setPanelError(
        `${provider.label} has no model that can serve ${FEATURE_LABEL[feature].toLowerCase()}.`,
      );
      return;
    }
    const result = await savePreference({
      feature,
      providerId,
      modelId: model.id,
    });
    if (result.ok) await refresh();
  };

  const handleChangeModel = async (
    feature: AiFeature,
    providerId: string,
    modelId: string,
    modelSource: AiModelSource,
    voice?: string,
  ) => {
    const result = await savePreference({
      feature,
      providerId: providerId as AiProviderId,
      modelId,
      modelSource,
      voice,
    });
    if (result.ok) await refresh();
  };

  const providerFor = (feature: AiFeature): string | undefined => {
    const kind = AI_FEATURE_KIND[feature];
    return (
      preferences[feature]?.providerId ??
      credentials.find((c) => c.verifiedKinds.includes(kind))?.providerId
    );
  };

  const currentSettings =
    settings.state.kind === "ready" ? settings.state.settings : null;

  return (
    <div
      className="space-y-6"
      aria-label="workspace-ai-panel"
      data-testid="workspace-ai-panel"
    >
      <p className="text-sm text-(--muted-foreground)">
        Everyone in this workspace spends the keys below when they use AI here.
        Without a key, Nimbus uses the operator&apos;s free tier, charged to the
        person asking ({status.free.docsLimit} document generations per
        account).
      </p>

      <section className="space-y-3">
        <header className="flex items-center justify-between">
          <h2 className="text-base font-semibold">API keys</h2>
          <Button
            size="xs"
            data-testid="ai-add-key"
            onClick={() => {
              setDialogInitialProvider(undefined);
              setDialogOpen(true);
            }}
            className="rounded-lg hover:cursor-pointer"
          >
            <Plus className="w-3 h-3 mr-1" />
            Add key
          </Button>
        </header>

        {credentialsState.kind === "error" && (
          <p role="alert" className="text-xs text-(--destructive)">
            {credentialsState.message}
          </p>
        )}

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
                disabled={removingProviderId === c.providerId}
                onReplace={() => {
                  setDialogInitialProvider(c.providerId as AiProviderId);
                  setDialogOpen(true);
                }}
                onRemove={() =>
                  void handleRemoveKey(c.providerId as AiProviderId)
                }
              />
            ))}
          </ul>
        )}

        {warnings.length > 0 && (
          <div
            role="status"
            data-testid="ai-save-warnings"
            className="rounded-lg border border-(--border) bg-(--muted)/30 px-3 py-2 text-xs text-(--muted-foreground)"
          >
            <p>Saved. Some model kinds could not be verified:</p>
            <ul className="list-disc pl-4">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        {panelError && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-(--destructive)/10 border border-(--destructive)/20">
            <Error className="w-4 h-4 text-(--destructive) shrink-0" />
            <span className="text-xs text-(--destructive)">{panelError}</span>
          </div>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-base font-semibold">Models</h2>
        <p className="text-xs text-(--muted-foreground)">
          Changes save automatically. Models without the required capabilities
          for a feature are hidden, and a custom text model id is checked before
          it is saved. Voice models come from the curated list.
        </p>

        {FEATURES.map(({ feature, label }) => (
          <div key={feature} className="space-y-2">
            <h3 className="text-xs font-medium uppercase text-(--muted-foreground)">
              {label}
            </h3>
            <AiModelPicker
              workspaceId={workspaceId}
              feature={feature}
              credentials={credentials}
              preference={preferences[feature]}
              pending={pending === feature}
              // The hook carries one error string at a time, so a
              // successful save for another picker clears it.
              error={
                pending === feature || pending === null
                  ? preferencesError
                  : null
              }
              onChangeProviderAction={(providerId) =>
                void handleChangeProvider(feature, providerId)
              }
              onChangeModelAction={(modelId, modelSource) => {
                const providerId = providerFor(feature);
                if (!providerId) return;
                void handleChangeModel(
                  feature,
                  providerId,
                  modelId,
                  modelSource,
                );
              }}
              onChangeVoiceAction={
                feature === "speech"
                  ? (voice) => {
                      const current = preferences.speech;
                      if (!current) return;
                      void handleChangeModel(
                        "speech",
                        current.providerId,
                        current.modelId,
                        "registry",
                        voice,
                      );
                    }
                  : undefined
              }
            />
          </div>
        ))}
      </section>

      <AssistantSection settings={settings} />
      <SpendCapSection settings={settings} current={currentSettings} />

      <ApiKeyDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSave={handleDialogSave}
        initialProvider={dialogInitialProvider}
      />
    </div>
  );
}

/** The two assistant switches. */
function AssistantSection({
  settings,
}: {
  settings: ReturnType<typeof useWorkspaceAiSettings>;
}) {
  const [error, setError] = useState<string | null>(null);
  if (settings.state.kind !== "ready") {
    return settings.state.kind === "error" ? (
      <p role="alert" className="text-xs text-(--destructive)">
        {settings.state.message}
      </p>
    ) : null;
  }
  const current = settings.state.settings;

  const flip = async (change: {
    assistantEnabled?: boolean;
    assistantSpeaks?: boolean;
  }) => {
    setError(null);
    const result = await settings.save(change);
    if (!result.ok) setError(result.message);
  };

  return (
    <section className="space-y-3" data-testid="ai-assistant-section">
      <h2 className="text-sm font-semibold">Assistant</h2>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          data-testid="ai-assistant-enabled"
          checked={current.assistantEnabled}
          disabled={settings.saving}
          onChange={(e) => void flip({ assistantEnabled: e.target.checked })}
        />
        Allow the in-call assistant
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          data-testid="ai-assistant-speaks"
          checked={current.assistantSpeaks}
          disabled={settings.saving || !current.assistantEnabled}
          onChange={(e) => void flip({ assistantSpeaks: e.target.checked })}
        />
        Let the assistant speak (otherwise it answers in chat)
      </label>
      {error && (
        <p role="alert" className="text-xs text-(--destructive)">
          {error}
        </p>
      )}
    </section>
  );
}

/** The monthly cap input, with the month-to-date spend beside it. */
function SpendCapSection({
  settings,
  current,
}: {
  settings: ReturnType<typeof useWorkspaceAiSettings>;
  current: {
    monthlySpendCapUsd: number | null;
    monthToDateCostUsd: number;
  } | null;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!current) return null;

  const shown = draft ?? current.monthlySpendCapUsd?.toString() ?? "";

  const commit = async (value: number | null) => {
    setError(null);
    const result = await settings.save({ monthlySpendCapUsd: value });
    if (result.ok) setDraft(null);
    else setError(result.message);
  };

  const submit = () => {
    const trimmed = shown.trim();
    if (trimmed === "") return void commit(null);
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError(
        "Enter an amount greater than zero, or leave it blank for no cap.",
      );
      return;
    }
    void commit(Math.round(parsed * 100) / 100);
  };

  return (
    <section className="space-y-3" data-testid="ai-spend-section">
      <h2 className="text-sm font-semibold">Monthly spend cap</h2>
      <div className="flex items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="ai-spend-cap" className="text-xs font-medium">
            Cap in USD (blank for none)
          </label>
          <Input
            id="ai-spend-cap"
            data-testid="ai-spend-cap-input"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={shown}
            onChange={(e) => setDraft(e.target.value)}
            className="w-40"
          />
        </div>
        <Button
          size="xs"
          data-testid="ai-spend-cap-save"
          loading={settings.saving}
          disabled={draft === null}
          onClick={submit}
          className="rounded-lg hover:cursor-pointer"
        >
          Save cap
        </Button>
        <p
          className="text-xs text-(--muted-foreground)"
          data-testid="ai-month-to-date"
        >
          This month so far: ${current.monthToDateCostUsd.toFixed(4)}
        </p>
      </div>
      <p className="text-xs text-(--muted-foreground)">
        An estimate from list prices. Calls to a model with no known price count
        as zero, and free-tier calls are not counted. A call already running
        when the cap is reached finishes.
      </p>
      {error && (
        <p role="alert" className="text-xs text-(--destructive)">
          {error}
        </p>
      )}
    </section>
  );
}

/** One row in the credential list, with masked preview, verified kinds and actions. */
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
      <div className="flex flex-col min-w-0 gap-1">
        <span className="text-sm font-medium truncate">
          {credential.label ?? credential.providerId}
        </span>
        <span className="text-xs text-(--muted-foreground) truncate font-mono">
          {credential.maskedPreview}
        </span>
        <span className="flex flex-wrap gap-1">
          {credential.verifiedKinds.map((kind) => (
            <span
              key={kind}
              data-testid={`ai-kind-${credential.providerId}-${kind}`}
              className="rounded-md border border-(--border) bg-(--muted)/50 px-1.5 py-0.5 text-[10px] text-(--muted-foreground)"
            >
              {KIND_LABEL[kind]}
            </span>
          ))}
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
