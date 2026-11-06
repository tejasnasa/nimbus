import { config } from "@nimbus/eslint-config/base";

/**
 * ESLint config for the LiveKit agent worker.
 *
 * The shared base config is the whole story: the worker is plain Node, with no
 * React tree, and `dist/` is already ignored by the base.
 *
 * @type {import("eslint").Linter.Config[]}
 */
export default [...config];
