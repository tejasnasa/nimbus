/**
 * @module api/routers/ai
 * @description Workspace AI REST endpoints (`/api/ai/*`): status, credential
 * CRUD, per-feature preferences, settings and the usage log, plus the caller's
 * own free allowance. Mounted behind `authCheck` from `master.router`, so
 * `req.user` is guaranteed present on every handler.
 *
 * Also hosts the model-picker support routes: the OpenRouter catalogue and the
 * capability probe for custom model ids, both under the workspace so they use
 * its credential.
 *
 * @important Everything under `/workspaces/:workspaceId` is gated by the
 *            controllers through `requireWorkspaceRole` (404 for non-members,
 *            403 below the route's role). The router stays thin on purpose:
 *            the permission rules live next to the data they protect. The one
 *            self-scoped route, `/me/free-usage`, reads only the caller's rows.
 */
import {
  aiCatalogQuerySchema,
  aiCredentialCreateSchema,
  aiModelProbeSchema,
  aiPreferenceSchema,
  aiSettingsSchema,
  aiUsageQuerySchema,
  ServerResponse,
} from "@nimbus/types";
import express from "express";
import validate from "../middleware/validate.middleware";
import {
  deleteWorkspaceAiCredential,
  getFreeUsage,
  getOpenRouterCatalogForFeature,
  getWorkspaceAiSettings,
  getWorkspaceAiStatus,
  getWorkspaceAiUsage,
  listWorkspaceAiCredentials,
  listWorkspaceAiPreferences,
  probeWorkspaceAiModel,
  updateWorkspaceAiSettings,
  upsertWorkspaceAiCredential,
  upsertWorkspaceAiPreference,
} from "../controllers/ai.controller";

const aiRouter = express.Router();

/** GET /api/ai/me/free-usage — the caller's free allowances. */
aiRouter.get("/me/free-usage", async (req, res) => {
  const { id } = req.user!;
  const response = await getFreeUsage(id);

  return res.status(response.statusCode).json(response);
});

/** GET /api/ai/workspaces/:workspaceId/status — the source of truth for the composer. */
aiRouter.get("/workspaces/:workspaceId/status", async (req, res) => {
  const { id } = req.user!;
  const response = await getWorkspaceAiStatus(id, req.params.workspaceId);

  return res.status(response.statusCode).json(response);
});

/** GET /api/ai/workspaces/:workspaceId/credentials — masked credentials (admin+). */
aiRouter.get("/workspaces/:workspaceId/credentials", async (req, res) => {
  const { id } = req.user!;
  const response = await listWorkspaceAiCredentials(id, req.params.workspaceId);

  return res.status(response.statusCode).json(response);
});

/**
 * POST /api/ai/workspaces/:workspaceId/credentials — probe, encrypt and upsert
 * a credential (admin+).
 *
 * The body is validated by Zod; `providerId` is constrained to the registry's
 * known set, so the controller can look the provider up without an
 * additional unknown-id branch.
 */
aiRouter.post(
  "/workspaces/:workspaceId/credentials",
  validate(aiCredentialCreateSchema),
  async (req, res) => {
    const { id } = req.user!;
    const { providerId, apiKey, label } = req.body;

    const response = await upsertWorkspaceAiCredential(
      id,
      req.params.workspaceId,
      providerId,
      apiKey,
      label,
    );

    return res.status(response.statusCode).json(response);
  },
);

/**
 * DELETE /api/ai/workspaces/:workspaceId/credentials/:providerId — remove a
 * credential and any preferences that pointed at it (admin+).
 */
aiRouter.delete(
  "/workspaces/:workspaceId/credentials/:providerId",
  async (req, res) => {
    const { id } = req.user!;
    const { workspaceId, providerId } = req.params;

    const response = await deleteWorkspaceAiCredential(id, workspaceId, providerId);

    return res.status(response.statusCode).json(response);
  },
);

/** GET /api/ai/workspaces/:workspaceId/preferences — saved per-feature choices (member). */
aiRouter.get("/workspaces/:workspaceId/preferences", async (req, res) => {
  const { id } = req.user!;
  const response = await listWorkspaceAiPreferences(id, req.params.workspaceId);

  return res.status(response.statusCode).json(response);
});

/**
 * PUT /api/ai/workspaces/:workspaceId/preferences — save a per-feature
 * preference (admin+).
 *
 * The body is validated by Zod; capability mismatches and missing credentials
 * are caught by the controller, not the schema, because they need the
 * registry and the credentials table to decide.
 */
aiRouter.put(
  "/workspaces/:workspaceId/preferences",
  validate(aiPreferenceSchema),
  async (req, res) => {
    const { id } = req.user!;
    // `capabilities` is deliberately not read from the body: the server copies or
    // measures them itself.
    const { feature, providerId, modelId, source, voice } = req.body;

    const response = await upsertWorkspaceAiPreference(
      id,
      req.params.workspaceId,
      feature,
      providerId,
      modelId,
      source,
      voice,
    );

    return res.status(response.statusCode).json(response);
  },
);

/** GET /api/ai/workspaces/:workspaceId/settings — spend cap and assistant switches (member). */
aiRouter.get("/workspaces/:workspaceId/settings", async (req, res) => {
  const { id } = req.user!;
  const response = await getWorkspaceAiSettings(id, req.params.workspaceId);

  return res.status(response.statusCode).json(response);
});

/** PUT /api/ai/workspaces/:workspaceId/settings — change the settings (admin+). */
aiRouter.put(
  "/workspaces/:workspaceId/settings",
  validate(aiSettingsSchema),
  async (req, res) => {
    const { id } = req.user!;
    const { monthlySpendCapUsd, assistantEnabled, assistantSpeaks } = req.body;

    const response = await updateWorkspaceAiSettings(id, req.params.workspaceId, {
      monthlySpendCapUsd,
      assistantEnabled,
      assistantSpeaks,
    });

    return res.status(response.statusCode).json(response);
  },
);

/**
 * GET /api/ai/workspaces/:workspaceId/usage — cursor-paged call log plus this
 * month's totals (admin+).
 */
aiRouter.get("/workspaces/:workspaceId/usage", async (req, res) => {
  const { id } = req.user!;
  const parsed = aiUsageQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    const response = ServerResponse.badRequest("Invalid usage query");
    return res.status(response.statusCode).json(response);
  }

  const response = await getWorkspaceAiUsage(id, req.params.workspaceId, parsed.data);

  return res.status(response.statusCode).json(response);
});

/**
 * GET /api/ai/workspaces/:workspaceId/catalog/openrouter?feature= — OpenRouter's
 * live model catalogue, filtered to models that meet the feature's hard
 * requirements (admin+).
 */
aiRouter.get("/workspaces/:workspaceId/catalog/openrouter", async (req, res) => {
  const { id } = req.user!;
  const parsed = aiCatalogQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    const response = ServerResponse.badRequest("Unknown feature");
    return res.status(response.statusCode).json(response);
  }

  const response = await getOpenRouterCatalogForFeature(
    id,
    req.params.workspaceId,
    parsed.data.feature,
  );

  return res.status(response.statusCode).json(response);
});

/**
 * POST /api/ai/workspaces/:workspaceId/models/probe — measures a model id's
 * capabilities with the workspace's credential for the provider (admin+).
 */
aiRouter.post(
  "/workspaces/:workspaceId/models/probe",
  validate(aiModelProbeSchema),
  async (req, res) => {
    const { id } = req.user!;
    const { providerId, modelId } = req.body;

    const response = await probeWorkspaceAiModel(
      id,
      req.params.workspaceId,
      providerId,
      modelId,
    );

    return res.status(response.statusCode).json(response);
  },
);

export default aiRouter;
