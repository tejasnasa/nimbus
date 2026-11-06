/**
 * @module agent/tsup.config
 * @description Bundles the worker into a single `dist/index.js`.
 *
 * @important Workspace packages (`@nimbus/*`) are inlined because they ship
 *            TypeScript source that Node cannot load from a deployed image;
 *            everything native or heavy stays external and is installed from
 *            npm in the image. `onnxruntime-node` must stay external: it
 *            resolves its `.node` binary relative to its own package directory.
 */
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  // The worker locates its own entry file by `import.meta.url`; the shim maps
  // it to `__filename` in the CommonJS output.
  shims: true,
  noExternal: [/^@nimbus\//],
  external: [/^@livekit\//, "onnxruntime-node"],
});
