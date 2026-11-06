# Runtime image for the voice agent worker.
#
# The bundle is built outside the image (`npm run build -w agent`), because it
# inlines the monorepo's workspace packages, which this directory alone cannot
# resolve. Only the LiveKit packages are installed here, as their native
# bindings (WebRTC and onnxruntime) must match the image's platform; Debian
# bookworm provides the glibc they need.
FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

# The slim image has no root certificates, and the native WebRTC layer reads the
# system store (not Node's bundled one), so without them joining a room fails.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./
# Dev dependencies point at unpublished workspace packages, so drop them before
# installing rather than letting npm try to resolve them from the registry.
# onnxruntime-node otherwise downloads a 300 MB CUDA provider at install and
# ships binaries for every platform; the agent runs Silero on the CPU only.
RUN npm pkg delete devDependencies \
  && ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm install --omit=dev --no-audit --no-fund \
  && cd node_modules/onnxruntime-node/bin/napi-v6 \
  && rm -rf darwin win32 linux/arm64 \
  && cd /app && npm cache clean --force

COPY dist ./dist

RUN useradd --create-home --uid 10001 agent
USER agent

CMD ["node", "dist/index.cjs", "start"]
