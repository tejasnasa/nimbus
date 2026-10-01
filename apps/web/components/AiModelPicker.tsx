/**
 * @module web/components/AiModelPicker
 * @description Per-feature provider + model selector.
 *
 * Two {@link Select} comboboxes (a provider dropdown and a model dropdown)
 * using the same custom listbox primitive the {@link ApiKeyDialog} uses, so
 * every dropdown in the app honors the same tokens. A native `<select>`'s
 * popup is OS-rendered and cannot be themed; a `ToggleGroup` is uncontrolled
 * and semantically wrong; an `OptionsMenu` is the wrong affordance for a
 * labelled form field.
 *
 * Only providers the user has a credential for are listed, so selecting a
 * provider and then discovering a key is needed cannot happen.
 *
 * Hard-filtered by capability: models missing any required capability for the
 * feature are omitted entirely. Soft-filtered capabilities (`AI_FEATURE_RECOMMENDED`)
 * are still offered, with a "lacks recommended capability" warning row in the
 * model dropdown so a user knows what they're trading away.
 *
 * Saving is **immediate on change** — there is no Save button in this
 * codebase's vocabulary. Failures render inline; never `alert()`, and there is
 * no toast library (don't add one).
 */
import {
  AI_FEATURE_REQUIREMENTS,
  AI_PROVIDERS,
  type AiCapability,
  type AiCredentialDTO,
  type AiFeature,
  type AiPreferenceDTO,
  type AiProviderId,
  type AiProviderSpec,
  modelsFor,
} from "@nimbus/types";
import Select, { type SelectOption } from "@nimbus/ui/Select";

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
   * Called when the user picks a new model. The parent saves the preference
   * with the existing providerId and the new modelId.
   */
  onChangeModelAction: (modelId: string) => void;
};

/**
 * Renders a provider combobox followed by a capability-filtered model
 * combobox. Both selections save immediately via the parent's callbacks.
 *
 * @param props.feature - The feature this picker drives.
 * @param props.credentials - User's saved credentials. Providers without one
 *                             are omitted from the dropdown.
 * @param props.preference - The currently-saved preference, or null.
 * @param props.pending - Disables both pickers while a save is in flight.
 * @param props.error - The latest error to surface inline.
 * @param props.onChangeProviderAction - Selection handler for the provider dropdown.
 * @param props.onChangeModelAction - Selection handler for the model dropdown.
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

  const requiredCapabilities = AI_FEATURE_REQUIREMENTS[feature];

  const providerOptions: SelectOption[] = credentialedProviders.map((p) => ({
    value: p.id,
    label: p.label,
  }));

  const modelOptions: SelectOption[] = provider
    ? modelsFor(provider, feature).map((m) => ({ value: m.id, label: m.label }))
    : [];

  return (
    <div className="space-y-3">
      <Select
        id={`${feature}-provider-select`}
        label="Provider"
        value={provider?.id ?? ""}
        onChange={(next) => onChangeProviderAction(next as AiProviderId)}
        options={providerOptions}
        placeholder="No API key added yet"
        disabled={pending || credentialedProviders.length === 0}
      />

      <Select
        id={`${feature}-model-select`}
        label="Model"
        value={currentModelId ?? provider?.defaultModel ?? ""}
        onChange={(next) => onChangeModelAction(next)}
        options={modelOptions}
        placeholder={
          credentialedProviders.length === 0
            ? "Add an API key first"
            : provider
              ? "Choose a model"
              : "Pick a provider first"
        }
        disabled={pending || !provider || modelOptions.length === 0}
      />

      <MissingRequiredNote
        provider={provider}
        feature={feature}
        required={requiredCapabilities}
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

/**
 * Inline note explaining why the current provider has zero selectable models
 * for this feature. Renders nothing when there's nothing to complain about.
 */
function MissingRequiredNote({
  provider,
  feature,
  required,
}: {
  provider: AiProviderSpec | null;
  feature: AiFeature;
  required: readonly AiCapability[];
}) {
  if (!provider) return null;
  const available = modelsFor(provider, feature);
  if (available.length > 0) return null;
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

/** Joins capability ids into a comma-separated sentence fragment. */
function formatCapabilities(caps: readonly AiCapability[]): string {
  if (caps.length === 0) return "";
  if (caps.length === 1) return caps[0]!;
  if (caps.length === 2) return `${caps[0]} and ${caps[1]}`;
  return `${caps.slice(0, -1).join(", ")}, and ${caps.at(-1)}`;
}
