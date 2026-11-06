/**
 * @module api/lib/ai/voiceAvailability
 * @description Decides whether the in-call assistant can run in a workspace for
 * a user, and on whose key, **without ever touching a plaintext key**.
 *
 * The decision is split from `voiceEntitlements` on purpose. The status route
 * needs the answer ("voice is available", "no voice key", "your free minutes
 * are spent") to draw the UI, but it must not be a module that can hand out a
 * key. This module returns a {@link VoicePlan} that names a credential row and
 * models; only `voiceEntitlements.resolveVoice` turns a plan into secrets.
 *
 * Voice is optional at three levels: plain calls need no key; captions and notes
 * need a transcription model; spoken replies also need a speech model, and
 * without one answers go to chat. The plan reflects that: `speech` is absent
 * when the workspace cannot, or has chosen not to, speak.
 *
 * @important Only a credential whose `verifiedKinds` includes the kind counts.
 *            A key that was saved but whose audio probe failed is never used for
 *            audio, however the workspace's preferences are set.
 */
import { prisma } from "@nimbus/db";
import {
  AI_DEFAULT_VOICE,
  defaultModelFor,
  meetsRequirements,
  modelById,
  type AiModelKind,
  type AiProviderId,
  type AiVoiceUnavailableReason,
} from "@nimbus/types";
import { freeVoiceTier, getProvider } from "./providers";
import { readVoiceQuotaState } from "./quota";
import { isOverCap } from "./spendCap";
import { readWorkspaceAiSettings } from "./workspaceSettings";

/** Why voice cannot run. The same codes the status DTO carries. */
export type VoiceRefusalReason = AiVoiceUnavailableReason;

/** A voice refusal with curated copy. */
export type VoiceRefusal = {
  readonly ok: false;
  readonly reason: VoiceRefusalReason;
  readonly message: string;
};

/** Which key pays for the assistant, and which models it uses. */
export type VoicePlan = {
  readonly source: "byok" | "free";
  /** The workspace credential, for a BYOK plan. */
  readonly credentialId?: string;
  readonly providerId: AiProviderId | null;
  readonly transcription: { readonly model: string };
  /** Absent when the assistant cannot or may not speak; answers go to chat. */
  readonly speech?: { readonly model: string; readonly voice: string };
};

/** The outcome of planning. */
export type VoicePlanResult =
  | { readonly ok: true; readonly plan: VoicePlan }
  | VoiceRefusal;

/** Collaborators the planner reads. Defaults to the live ones. */
export type VoicePlanDeps = {
  readonly prisma?: typeof prisma;
  readonly isOverCap?: (workspaceId: string) => Promise<boolean>;
};

const MESSAGES: Record<VoiceRefusalReason, string> = {
  "assistant-disabled": "The assistant is turned off for this workspace.",
  "no-voice-key":
    "Voice needs a transcription key. A workspace admin can add one in AI settings.",
  "free-voice-exhausted":
    "You've used all your free assistant minutes. A workspace admin can add a voice key in AI settings.",
  "spend-cap-reached":
    "This workspace has reached its monthly AI spend cap. An admin can raise it in AI settings.",
};

const refuse = (reason: VoiceRefusalReason): VoiceRefusal => ({
  ok: false,
  reason,
  message: MESSAGES[reason],
});

/**
 * Plans the assistant for a workspace and user.
 *
 * Order of precedence: the admin switch, then the workspace's own verified
 * transcription key (subject to the spend cap), then the operator's free tier
 * (subject to the user's free seconds).
 *
 * @param input - The workspace and the user who would start the assistant.
 * @param deps - Test seams.
 * @returns A plan naming the key and models, or a curated refusal.
 */
export async function planVoice(
  input: { workspaceId: string; userId: string },
  deps: VoicePlanDeps = {},
): Promise<VoicePlanResult> {
  const { workspaceId, userId } = input;
  const db = deps.prisma ?? prisma;

  const settings = await readWorkspaceAiSettings(workspaceId, db);
  if (!settings.assistantEnabled) return refuse("assistant-disabled");

  const [credentials, preferences] = await Promise.all([
    db.workspaceAiCredential.findMany({
      where: { workspaceId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, providerId: true, verifiedKinds: true },
    }),
    db.workspaceAiPreference.findMany({
      where: { workspaceId, feature: { in: ["TRANSCRIPTION", "SPEECH"] } },
      select: { feature: true, providerId: true, modelId: true, voice: true },
    }),
  ]);

  const verified = (kind: AiModelKind) =>
    credentials.filter(
      (c) =>
        getProvider(c.providerId as AiProviderId) !== undefined &&
        c.verifiedKinds.includes(kind),
    );

  const transcriptionPref = preferences.find((p) => p.feature === "TRANSCRIPTION");
  const speechPref = preferences.find((p) => p.feature === "SPEECH");

  // Transcription: the preferred provider when its credential is verified and
  // the preferred model still qualifies, else the earliest verified credential.
  const transcriptionCandidates = verified("transcription");
  let transcription:
    | { credentialId: string; providerId: AiProviderId; model: string }
    | undefined;
  const preferred = transcriptionPref
    ? transcriptionCandidates.find((c) => c.providerId === transcriptionPref.providerId)
    : undefined;
  if (preferred && transcriptionPref) {
    const provider = getProvider(preferred.providerId as AiProviderId)!;
    const model = modelById(provider, transcriptionPref.modelId);
    if (model && meetsRequirements(model, "transcription")) {
      transcription = {
        credentialId: preferred.id,
        providerId: provider.id,
        model: model.id,
      };
    }
  }
  if (!transcription) {
    for (const credential of transcriptionCandidates) {
      const provider = getProvider(credential.providerId as AiProviderId)!;
      const model = defaultModelFor(provider, "transcription");
      if (model) {
        transcription = {
          credentialId: credential.id,
          providerId: provider.id,
          model: model.id,
        };
        break;
      }
    }
  }

  if (transcription) {
    if (await (deps.isOverCap ?? isOverCap)(workspaceId)) {
      return refuse("spend-cap-reached");
    }

    // Speech rides the same credential: one base URL and one key reach the
    // agent, so a speech model on another provider cannot be used.
    let speech: VoicePlan["speech"];
    if (settings.assistantSpeaks) {
      const credential = credentials.find((c) => c.id === transcription!.credentialId)!;
      if (credential.verifiedKinds.includes("speech")) {
        const provider = getProvider(transcription.providerId)!;
        const wanted =
          speechPref && speechPref.providerId === provider.id
            ? modelById(provider, speechPref.modelId)
            : undefined;
        const model =
          wanted && meetsRequirements(wanted, "speech")
            ? wanted
            : defaultModelFor(provider, "speech");
        if (model) {
          const voices = model.voices ?? [AI_DEFAULT_VOICE];
          const voice =
            wanted === model && speechPref?.voice && voices.includes(speechPref.voice)
              ? speechPref.voice
              : (voices[0] ?? AI_DEFAULT_VOICE);
          speech = { model: model.id, voice };
        }
      }
    }

    return {
      ok: true,
      plan: {
        source: "byok",
        credentialId: transcription.credentialId,
        providerId: transcription.providerId,
        transcription: { model: transcription.model },
        speech,
      },
    };
  }

  const free = freeVoiceTier();
  if (!free) return refuse("no-voice-key");
  const quota = await readVoiceQuotaState(userId);
  if (quota.exhausted) return refuse("free-voice-exhausted");

  return {
    ok: true,
    plan: {
      source: "free",
      providerId: null,
      transcription: { model: free.transcribeModel },
      speech: settings.assistantSpeaks
        ? { model: free.speechModel, voice: free.speechVoice }
        : undefined,
    },
  };
}

/** What the status route reports about voice. */
export type VoiceAvailability = {
  readonly available: boolean;
  readonly reason: VoiceRefusalReason | null;
  readonly speaks: boolean;
};

/**
 * The key-free summary of {@link planVoice}, for the status route.
 *
 * @param input - The workspace and the asking user.
 * @param deps - Test seams.
 */
export async function voiceAvailability(
  input: { workspaceId: string; userId: string },
  deps: VoicePlanDeps = {},
): Promise<VoiceAvailability> {
  const result = await planVoice(input, deps);
  if (!result.ok) return { available: false, reason: result.reason, speaks: false };
  return { available: true, reason: null, speaks: result.plan.speech !== undefined };
}
