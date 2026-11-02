"use client";

/**
 * @module web/components/AiModelPicker
 * @description Per-feature provider + model selector.
 *
 * A provider {@link Select}, then a searchable model {@link Combobox}. The model
 * list has three sources, each marked on the saved preference:
 *
 *   - `registry`: the curated models in `@nimbus/types`;
 *   - `catalog`: for OpenRouter, the live catalogue filtered server-side to
 *     models that meet the feature's hard requirements;
 *   - `custom`: the last row, **Use a custom model id...**, swaps the combobox
 *     for a text input and a **Check model** button. The check runs the server's
 *     capability probe with the user's own key, shows what was measured, and
 *     saves only when the measured set can serve the feature.
 *
 * Each row shows the label, the id in muted text, capability chips and, when
 * known, the input and output price per million tokens.
 *
 * Only providers the user has a credential for are listed. Models missing a
 * hard requirement for the feature are omitted (registry, catalogue) or refused
 * with the missing capability named (custom). Models missing a *recommended*
 * capability are still offered, with a note once one is selected.
 *
 * Saving is **immediate on change**, and on a successful check for a custom id.
 * Failures render inline; never `alert()`, and there is no toast library (do not
 * add one).
 */
import {
  AI_FEATURE_RECOMMENDED,
  AI_FEATURE_REQUIREMENTS,
  AI_PROVIDERS,
  type AiCapability,
  type AiCredentialDTO,
  type AiFeature,
  type AiModelPricing,
  type AiModelSource,
  type AiPreferenceDTO,
  type AiProviderId,
  type AiProviderSpec,
  capabilitiesMeetRequirements,
  modelsFor,
} from "@nimbus/types";
import Button from "@nimbus/ui/Button";
import Combobox, { type ComboboxOption } from "@nimbus/ui/Combobox";
import Input from "@nimbus/ui/Input";
import Select, { type SelectOption } from "@nimbus/ui/Select";
import { useMemo, useState } from "react";
import { useAiCatalog } from "../hooks/useAiCatalog";
import { useAiModelProbe } from "../hooks/useAiModelProbe";

type Props = {
  /** Which feature this picker drives (drives capability requirements). */
  feature: AiFeature;
  /** The user's saved credentials. Used to filter the provider list. */
  credentials: readonly AiCredentialDTO[];
  /** The currently-saved preference, or `null` when none. */
  preference: AiPreferenceDTO | null;
  /** Whether the save is in flight for this feature. Disables both pickers. */
  pending?: boolean;
  /** The most recent error string from a save attempt, or `null`. */
  error?: string | null;
  /**
   * Called when the user picks a new provider. The parent saves the
   * preference with the provider's `defaultModel` for the feature.
   */
  onChangeProviderAction: (providerId: AiProviderId) => void;
  /**
   * Called when the user picks a model. The parent saves the preference with
   * the existing providerId, the model id and where it came from.
   */
  onChangeModelAction: (modelId: string, source: AiModelSource) => void;
};

/** One row of the model list, whatever its source. */
type ModelEntry = {
  id: string;
  label: string;
  source: AiModelSource;
  capabilities: readonly AiCapability[];
  /** Per-million prices, when known. */
  prices: { input: number; output: number } | null;
};

/** The chips shown on a row, in this order. */
const CHIPS: ReadonlyArray<{ capability: AiCapability; label: string }> = [
  { capability: "tools", label: "Tools" },
  { capability: "jsonMode", label: "JSON" },
  { capability: "vision", label: "Vision" },
  { capability: "reasoning", label: "Reasoning" },
];

/** Registry pricing to a display pair, or null unless both prices exist. */
function registryPrices(
  pricing: AiModelPricing | undefined,
): ModelEntry["prices"] {
  if (pricing?.inputPerMTok === undefined || pricing.outputPerMTok === undefined) {
    return null;
  }
  return { input: pricing.inputPerMTok, output: pricing.outputPerMTok };
}

/** `0.15` becomes `$0.15` and `2` becomes `$2`; up to three decimals are kept. */
const formatPrice = (usd: number): string =>
  usd === 0 ? "$0" : `$${Number(usd.toFixed(usd < 0.01 ? 4 : 3))}`;

/**
 * Renders a provider select followed by a searchable, capability-filtered model
 * combobox. Selections save immediately via the parent's callbacks.
 *
 * @param props.feature - The feature this picker drives.
 * @param props.credentials - User's saved credentials; providers without one are omitted.
 * @param props.preference - The currently-saved preference, or null.
 * @param props.pending - Disables both pickers while a save is in flight.
 * @param props.error - The latest error to surface inline.
 * @param props.onChangeProviderAction - Selection handler for the provider dropdown.
 * @param props.onChangeModelAction - Selection handler for the model combobox.
 */
export default function AiModelPicker({
  feature,
  credentials,
  preference,
  pending = false,
  error = null,
  onChangeProviderAction,
  onChangeModelAction,
}: Props) {
  const credentialedProviders = credentials
    .map((c) => AI_PROVIDERS[c.providerId as AiProviderId])
    .filter((p): p is AiProviderSpec => p !== undefined);

  const currentProviderId = preference?.providerId as
    | AiProviderId
    | undefined
    | null;
  const currentModelId = preference?.modelId ?? null;

  const provider =
    (currentProviderId && AI_PROVIDERS[currentProviderId]) ||
    credentialedProviders[0] ||
    null;

  const [customOpen, setCustomOpen] = useState(false);
  const [customId, setCustomId] = useState("");
  const probe = useAiModelProbe();

  const catalog = useAiCatalog(feature, provider?.id === "openrouter");

  const entries = useMemo<ModelEntry[]>(() => {
    if (!provider) return [];
    const list: ModelEntry[] = modelsFor(provider, feature).map((m) => ({
      id: m.id,
      label: m.label,
      source: "registry",
      capabilities: m.capabilities,
      prices: registryPrices(m.pricing),
    }));
    const seen = new Set(list.map((e) => e.id));

    if (provider.id === "openrouter") {
      for (const m of catalog.models) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        list.push({
          id: m.id,
          label: m.label,
          source: "catalog",
          capabilities: m.capabilities,
          prices: m.pricing
            ? { input: m.pricing.inputPerMTok, output: m.pricing.outputPerMTok }
            : null,
        });
      }
    }

    // A saved model that is not in the list (a custom id, a catalogue entry that
    // has since dropped out, a registry id since retired) must still show as the
    // current choice. Without a row for it the trigger falls back to its
    // placeholder and the picker looks empty.
    if (
      currentModelId &&
      provider.id === currentProviderId &&
      !seen.has(currentModelId)
    ) {
      list.unshift({
        id: currentModelId,
        label: currentModelId,
        source: preference?.modelSource ?? "registry",
        capabilities: preference?.modelCapabilities ?? [],
        prices: null,
      });
    }
    return list;
  }, [provider, feature, catalog.models, currentModelId, currentProviderId, preference]);

  const byId = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);

  const providerOptions: SelectOption[] = credentialedProviders.map((p) => ({
    value: p.id,
    label: p.label,
  }));

  const modelOptions: ComboboxOption[] = entries.map((e) => ({
    value: e.id,
    label: e.label,
    description: e.id,
  }));

  const selectedId = currentModelId ?? provider?.defaultModel ?? "";
  const selectedEntry = byId.get(selectedId);

  const handleCheck = async () => {
    const id = customId.trim();
    if (!provider || id === "") return;
    const measured = await probe.check(provider.id, id);
    if (!measured) return;
    if (capabilitiesMeetRequirements(measured.capabilities, feature)) {
      onChangeModelAction(id, "custom");
    }
  };

  const required = AI_FEATURE_REQUIREMENTS[feature];
  const missing = probe.result
    ? required.filter((c) => !probe.result!.capabilities.includes(c))
    : [];

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex w-full gap-4">
        <Select
          id={`${feature}-provider-select`}
          className="w-full"
          label="Provider"
          value={provider?.id ?? ""}
          onChange={(next) => onChangeProviderAction(next as AiProviderId)}
          options={providerOptions}
          placeholder="No API key added yet"
          disabled={pending || credentialedProviders.length === 0}
        />

        {customOpen ? (
          <div className="flex w-full flex-col gap-1">
            <label
              htmlFor={`${feature}-custom-model-input`}
              className="text-xs font-medium"
            >
              Custom model id
            </label>
            <div className="flex gap-2">
              <Input
                id={`${feature}-custom-model-input`}
                data-testid={`${feature}-custom-model-input`}
                className="w-full"
                placeholder="vendor/model-name"
                value={customId}
                disabled={pending || probe.checking}
                onChange={(e) => {
                  setCustomId(e.target.value);
                  probe.reset();
                }}
              />
              <Button
                type="button"
                data-testid={`${feature}-check-model`}
                loading={probe.checking}
                disabled={pending || customId.trim() === ""}
                onClick={() => void handleCheck()}
                className="shrink-0 hover:cursor-pointer"
              >
                Check model
              </Button>
              <Button
                type="button"
                data-testid={`${feature}-custom-cancel`}
                onClick={() => {
                  setCustomOpen(false);
                  setCustomId("");
                  probe.reset();
                }}
                className="shrink-0 bg-transparent border border-(--border) text-(--foreground) hover:bg-(--muted) hover:cursor-pointer"
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Combobox
            id={`${feature}-model-select`}
            className="w-full"
            label="Model"
            value={selectedId}
            onChange={(next) => {
              const entry = byId.get(next);
              onChangeModelAction(next, entry?.source ?? "registry");
            }}
            options={modelOptions}
            placeholder={
              credentialedProviders.length === 0
                ? "Add an API key first"
                : provider
                  ? "Choose a model"
                  : "Pick a provider first"
            }
            emptyText="No model matches"
            footerAction={
              provider
                ? {
                    label: "Use a custom model id…",
                    onSelect: () => setCustomOpen(true),
                  }
                : undefined
            }
            renderOption={(option) => (
              <ModelRow entry={byId.get(option.value)} fallback={option} />
            )}
            disabled={pending || !provider}
          />
        )}
      </div>

      {customOpen && (probe.result || probe.error) && (
        <div
          data-testid={`${feature}-probe-result`}
          className="space-y-1.5 rounded-xl border border-(--border) bg-(--muted)/30 px-3 py-2"
        >
          {probe.error && (
            <p role="alert" className="text-xs text-(--destructive)">
              {probe.error}
            </p>
          )}
          {probe.result && (
            <>
              <CapabilityChips capabilities={probe.result.capabilities} />
              <p className="text-xs text-(--muted-foreground)">
                {probe.result.servesFeatures.length > 0
                  ? `Can serve: ${probe.result.servesFeatures.join(", ")}.`
                  : "This model cannot serve any feature."}
              </p>
              {missing.length > 0 && (
                <p
                  role="alert"
                  data-testid={`${feature}-custom-refused`}
                  className="text-xs text-(--destructive)"
                >
                  Not saved: this model lacks {formatCapabilities(missing)}, which{" "}
                  {feature} needs.
                </p>
              )}
            </>
          )}
        </div>
      )}

      <MissingRequiredNote
        provider={provider}
        feature={feature}
        required={required}
        catalogCount={catalog.models.length}
        catalogLoading={catalog.loading}
      />

      {catalog.error && provider?.id === "openrouter" && (
        <p
          role="note"
          data-testid={`${feature}-catalog-error`}
          className="text-[11px] text-(--muted-foreground)"
        >
          {catalog.error} The curated models are still available.
        </p>
      )}

      <RecommendedNote
        feature={feature}
        capabilities={selectedEntry?.capabilities ?? null}
      />

      {error && (
        <p
          role="alert"
          data-testid={`${feature}-picker-error`}
          className="text-xs text-(--destructive)"
        >
          {error}
        </p>
      )}
    </div>
  );
}

/** One combobox row: label, muted id, chips and price. */
function ModelRow({
  entry,
  fallback,
}: {
  entry: ModelEntry | undefined;
  fallback: ComboboxOption;
}) {
  if (!entry) {
    return <span className="block truncate">{fallback.label}</span>;
  }
  return (
    <span className="flex flex-col gap-0.5">
      <span className="truncate">{entry.label}</span>
      <span className="truncate text-xs text-(--muted-foreground) font-mono">
        {entry.id}
      </span>
      <span className="flex flex-wrap items-center gap-1.5">
        <CapabilityChips capabilities={entry.capabilities} />
        {entry.prices && (
          <span
            data-testid={`price-${entry.id}`}
            className="text-[10px] text-(--muted-foreground)"
          >
            {formatPrice(entry.prices.input)} in / {formatPrice(entry.prices.output)}{" "}
            out per 1M
          </span>
        )}
      </span>
    </span>
  );
}

/** The Tools / JSON / Vision / Reasoning chips for a capability list. */
function CapabilityChips({
  capabilities,
}: {
  capabilities: readonly AiCapability[];
}) {
  const shown = CHIPS.filter((c) => capabilities.includes(c.capability));
  if (shown.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {shown.map((chip) => (
        <span
          key={chip.capability}
          data-testid={`chip-${chip.capability}`}
          className="rounded-md border border-(--border) bg-(--muted)/50 px-1.5 py-0.5 text-[10px] text-(--muted-foreground)"
        >
          {chip.label}
        </span>
      ))}
    </span>
  );
}

/**
 * Inline note explaining why the current provider has zero selectable models
 * for this feature. Renders nothing when there's nothing to complain about.
 */
function MissingRequiredNote({
  provider,
  feature,
  required,
  catalogCount,
  catalogLoading,
}: {
  provider: AiProviderSpec | null;
  feature: AiFeature;
  required: readonly AiCapability[];
  catalogCount: number;
  catalogLoading: boolean;
}) {
  if (!provider) return null;
  if (modelsFor(provider, feature).length > 0) return null;
  // OpenRouter's catalogue may still supply models; do not complain while it
  // loads or when it has some.
  if (provider.id === "openrouter" && (catalogLoading || catalogCount > 0)) {
    return null;
  }
  return (
    <p
      role="note"
      data-testid={`${feature}-picker-missing`}
      className="text-[11px] text-(--muted-foreground) leading-relaxed"
    >
      {provider.label} has no model that supports {formatCapabilities(required)}{" "}
      for {feature}. Add a key for another provider or pick a different one.
    </p>
  );
}

/**
 * Warning that the selected model lacks a capability the feature works better
 * with. The model is still usable; this only says what is being traded away.
 */
function RecommendedNote({
  feature,
  capabilities,
}: {
  feature: AiFeature;
  capabilities: readonly AiCapability[] | null;
}) {
  if (!capabilities) return null;
  const lacking = AI_FEATURE_RECOMMENDED[feature].filter(
    (c) => !capabilities.includes(c),
  );
  if (lacking.length === 0) return null;
  return (
    <p
      role="note"
      data-testid={`${feature}-picker-recommended`}
      className="text-[11px] text-(--muted-foreground) leading-relaxed"
    >
      This model lacks {formatCapabilities(lacking)}, which {feature} works
      better with. It will still run.
    </p>
  );
}

/** Joins capability ids into a comma-separated sentence fragment. */
function formatCapabilities(caps: readonly AiCapability[]): string {
  if (caps.length === 0) return "";
  if (caps.length === 1) return caps[0]!;
  if (caps.length === 2) return `${caps[0]} and ${caps[1]}`;
  return `${caps.slice(0, -1).join(", ")}, and ${caps.at(-1)}`;
}
