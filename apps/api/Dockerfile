FROM node:20-alpine AS base

# Prune the monorepo
FROM base AS pruner
RUN npm install -g turbo
WORKDIR /app
COPY . .
RUN turbo prune api --docker

# Install deps & build
FROM base AS builder
WORKDIR /app

# Copy lockfile and package manifests from pruned output
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/package-lock.json ./package-lock.json
RUN npm ci

# Copy full pruned source and build
COPY --from=pruner /app/out/full/ .
RUN DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" npx turbo build --filter=api

# Production image
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

# Only copy what's needed to run
COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/apps/api/package.json .
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages

EXPOSE 8080
CMD ["node", "dist/index.js"]