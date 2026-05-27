# syntax=docker/dockerfile:1.7-labs
#
# Build from the monorepo root so the root pnpm-lock.yaml is in context:
#   docker build -t x402b-webhook-sink -f examples/webhook-sink/Dockerfile .
#
# corepack reads `packageManager` from the root package.json and pins pnpm.

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

# --- Stage 1: install (cache key = lockfile + workspace manifests) ---
# Source code is NOT copied here, so this layer only invalidates when
# pnpm-lock.yaml or a package.json changes. BuildKit's pnpm-store cache
# mount reuses tarballs across rebuilds even when install does re-run.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY --parents typescript/packages/*/package.json examples/*/package.json ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile \
    --filter @bosonprotocol/x402-example-webhook-sink...

# --- Stage 2: deploy (invalidated when source changes) ---
# `pnpm deploy` materializes a self-contained directory with a flat
# node_modules — required because the workspace install uses a virtual
# store, and the symlinks under examples/webhook-sink/node_modules point
# back into /repo/node_modules/.pnpm/... which wouldn't exist in the
# runtime stage. --legacy keeps the pnpm-9 behavior (includes
# devDependencies so `tsx` is available at runtime).
FROM deps AS build
COPY . .
RUN pnpm --filter @bosonprotocol/x402-example-webhook-sink deploy --legacy /deploy

# --- Stage 3: runtime ---
FROM node:22-alpine AS runtime
WORKDIR /app
COPY --from=build /deploy ./

ENV PORT=4000
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" >/dev/null || exit 1

USER node
CMD ["npx", "tsx", "src/index.ts"]
