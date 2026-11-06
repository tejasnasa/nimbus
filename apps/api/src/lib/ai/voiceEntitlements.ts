/**
 * @module api/lib/ai/voiceEntitlements
 * @description Resolves the keys and models the in-call assistant uses for a
 * workspace: the one place a plaintext voice key is produced.
 *
 * `resolveVoice` takes the key-free plan from `voiceAvailability` and, for a
 * BYOK plan, decrypts the workspace credential; for the free tier it reads the
 * operator's voice key from env. The result is what the meeting ticket carries
 * to the agent for the length of one session.
 *
 * @important This is the only function that returns a plaintext key, and only
 *            the meeting ticket redemption (`lib/meeting/tickets.ts`) may call
 *            it. A lint rule (`no-restricted-imports` in `apps/api`) refuses an
 *            import of this module from anywhere else; anything that merely
 *            needs to know whether voice works imports `voiceAvailability`.
 *            Never log, cache or return the result outside that path.
 */
import { prisma } from "@nimbus/db";
import type { AiProviderId } from "@nimbus/types";
import { buildAad, decryptSecret } from "./credentialCrypto";
import { freeVoiceTier, getProvider, resolveBaseUrl } from "./providers";
import {
  planVoice,
  type VoicePlanDeps,
  type VoiceRefusal,
} from "./voiceAvailability";

/** A resolved assistant, with the secrets the agent needs. */
export type VoiceSuccess = {
  readonly ok: true;
  readonly source: "byok" | "free";
  readonly providerId: AiProviderId | null;
  readonly credentialId?: string;
  readonly transcription: {
    readonly baseUrl: string;
    readonly apiKey: string;
    readonly model: string;
  };
  /** Absent when answers go to chat rather than being spoken. */
  readonly speech?: { readonly model: string; readonly voice: string };
};

/** The discriminated union the ticket redemption consumes. */
export type VoiceResolution = VoiceSuccess | VoiceRefusal;

/**
 * Resolves the assistant's keys for a workspace and user.
 *
 * @param input - The workspace and the user starting the assistant.
 * @param deps - Test seams.
 * @returns The keys and models, or a refusal: `no-voice-key`,
 *          `free-voice-exhausted`, `assistant-disabled` or `spend-cap-reached`.
 *          A stored key that can no longer be decrypted reads as `no-voice-key`.
 */
export async function resolveVoice(
  input: { workspaceId: string; userId: string },
  deps: VoicePlanDeps = {},
): Promise<VoiceResolution> {
  const planned = await planVoice(input, deps);
  if (!planned.ok) return planned;
  const { plan } = planned;

  if (plan.source === "free") {
    const free = freeVoiceTier();
    if (!free) {
      return {
        ok: false,
        reason: "no-voice-key",
        message: "Voice is not configured on this deployment.",
      };
    }
    return {
      ok: true,
      source: "free",
      providerId: null,
      transcription: {
        baseUrl: free.baseUrl,
        apiKey: free.apiKey,
        model: plan.transcription.model,
      },
      speech: plan.speech,
    };
  }

  const db = deps.prisma ?? prisma;
  const credential = await db.workspaceAiCredential.findUnique({
    where: { id: plan.credentialId! },
    select: { keyEnvelope: true, providerId: true },
  });
  const provider = getProvider(plan.providerId!);
  if (!credential || !provider) {
    return {
      ok: false,
      reason: "no-voice-key",
      message:
        "Voice needs a transcription key. A workspace admin can add one in AI settings.",
    };
  }

  let apiKey: string;
  try {
    apiKey = decryptSecret(
      credential.keyEnvelope,
      buildAad(
        { kind: "workspace", workspaceId: input.workspaceId },
        credential.providerId,
      ),
    );
  } catch {
    console.error(
      `[ai] Failed to decrypt the voice credential for workspace ${input.workspaceId}.`,
    );
    return {
      ok: false,
      reason: "no-voice-key",
      message:
        "The workspace's stored credential could not be read. An admin needs to add it again.",
    };
  }

  return {
    ok: true,
    source: "byok",
    providerId: provider.id,
    credentialId: plan.credentialId,
    transcription: {
      baseUrl: resolveBaseUrl(provider),
      apiKey,
      model: plan.transcription.model,
    },
    speech: plan.speech,
  };
}
