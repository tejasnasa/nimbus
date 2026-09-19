import { config } from "@nimbus/eslint-config/base";

/**
 * ESLint config for the Express + Socket.IO API server.
 *
 * The shared base config is the whole story here: there is no React tree and no
 * Next.js, and `dist/` is already ignored by the base. Rules are left at their
 * default severities (the shared config downgrades them to warnings), so this
 * gate reports without failing on the warnings the package already carries.
 *
 * @type {import("eslint").Linter.Config[]}
 */
export default [...config];
