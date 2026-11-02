/**
 * @module api/routers/ai
 * @description BYOK REST endpoints (`/api/ai/*`): status, credential CRUD, and
 * per-feature preferences. Mounted behind `authCheck` from `master.router`,
 * so `req.user` is guaranteed present on every handler.
 *
 * Also hosts the model-picker support routes: the OpenRouter catalogue and the
 * capability probe for custom model ids.
 *
 * @important None of this is workspace-scoped. The OWNER > ADMIN > MEMBER
 *            ladder does not apply — the resource belongs to the caller, and
 *            the controllers enforce that ownership at the DB query level
 *            (`where: { userId }`). The plan calls this out explicitly so a
 *            reviewer does not assume RBAC checks are missing by accident.
 */
import {
  aiCatalogQuerySchema,
  aiCredentialCreateSchema,
  aiModelProbeSchema,
  aiPreferenceSchema,
  ServerResponse,
} from "@nimbus/types";
import express from "express";
import validate from "../middleware/validate.middleware";
import {
  deleteAiCredential,
  getAiStatus,
  getOpenRouterCatalogForFeature,
  listAiCredentials,
  listAiPreferences,
  probeAiModel,
  upsertAiCredential,
  upsertAiPreference,
} from "../controllers/ai.controller";

const aiRouter = express.Router();

/** GET /api/ai/status — the source of truth for the disabled composer. */
aiRouter.get("/status", async (req, res) => {
  const { id } = req.user!;
  const response = await getAiStatus(id);

  return res.status(response.statusCode).json(response);
});

/** GET /api/ai/credentials — the user's saved credentials (masked). */
aiRouter.get("/credentials", async (req, res) => {
  const { id } = req.user!;
  const response = await listAiCredentials(id);

  return res.status(response.statusCode).json(response);
});

/**
 * POST /api/ai/credentials — save (probe + store) or replace a credential.
 *
 * The body is validated by Zod; `providerId` is constrained to the registry's
 * known set, so the controller can look the provider up without an
 * additional unknown-id branch.
 */
aiRouter.post(
  "/credentials",
  validate(aiCredentialCreateSchema),
  async (req, res) => {
    const { id } = req.user!;
    const { providerId, apiKey, label } = req.body;

    const response = await upsertAiCredential(id, providerId, apiKey, label);

    return res.status(response.statusCode).json(response);
  },
);

/**
 * DELETE /api/ai/credentials/:providerId — remove a credential and any
 * preferences that pointed at it.
 */
aiRouter.delete("/credentials/:providerId", async (req, res) => {
  const { id } = req.user!;
  const { providerId } = req.params;

  const response = await deleteAiCredential(id, providerId);

  return res.status(response.statusCode).json(response);
});

/** GET /api/ai/preferences — the user's per-feature saved choices. */
aiRouter.get("/preferences", async (req, res) => {
  const { id } = req.user!;
  const response = await listAiPreferences(id);

  return res.status(response.statusCode).json(response);
});

/**
 * PUT /api/ai/preferences — save a per-feature preference.
 *
 * The body is validated by Zod; capability mismatches and missing credentials
 * are caught by the controller, not the schema, because they need the
 * registry and the credentials table to decide.
 */
aiRouter.put("/preferences", validate(aiPreferenceSchema), async (req, res) => {
  const { id } = req.user!;
  // `capabilities` is deliberately not read from the body: the server copies or
  // measures them itself.
  const { feature, providerId, modelId, source } = req.body;

  const response = await upsertAiPreference(
    id,
    feature,
    providerId,
    modelId,
    source,
  );

  return res.status(response.statusCode).json(response);
});

/**
 * GET /api/ai/catalog/openrouter?feature= — OpenRouter's live model catalogue,
 * filtered to models that meet the feature's hard requirements.
 */
aiRouter.get("/catalog/openrouter", async (req, res) => {
  const parsed = aiCatalogQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    const response = ServerResponse.badRequest("Unknown feature");
    return res.status(response.statusCode).json(response);
  }

  const response = await getOpenRouterCatalogForFeature(parsed.data.feature);

  return res.status(response.statusCode).json(response);
});

/**
 * POST /api/ai/models/probe — measures a model id's capabilities with the
 * caller's own credential for the provider.
 */
aiRouter.post("/models/probe", validate(aiModelProbeSchema), async (req, res) => {
  const { id } = req.user!;
  const { providerId, modelId } = req.body;

  const response = await probeAiModel(id, providerId, modelId);

  return res.status(response.statusCode).json(response);
});

export default aiRouter;
