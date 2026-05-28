# syntax=docker/dockerfile:1.7-labs
#
# Build from the monorepo root so the root pnpm-lock.yaml is in context:
#   docker build -t x402b-facilitator-http -f examples/facilitator-http/Dockerfile .
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
    pnpm install --frozen-lockfile --include-workspace-root \
    --filter @bosonprotocol/x402-example-facilitator-http...

# --- Stage 2: build + deploy (invalidated when source changes) ---
# Build the workspace deps the example imports (tsup emits dist/ + the
# exports map points at it). The trailing `...` includes transitive
# workspace deps (x402-core, x402-evm, x402-actions, x402-fulfillment).
#
# Invoke turbo (not recursive pnpm) so the .turbo cache mount short-
# circuits unchanged packages by content hash. `--include-workspace-root`
# on the install above is what makes `pnpm exec turbo` resolvable here.
#
# `pnpm deploy --legacy` flattens the virtual store into a self-contained
# dir; --legacy keeps the pnpm-9 deploy semantics. See
# examples/webhook-sink/Dockerfile for the longer rationale.
FROM deps AS build
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    --mount=type=cache,id=turbo,target=/repo/.turbo \
    pnpm exec turbo run build --filter=@bosonprotocol/x402-facilitator-express...
RUN pnpm --filter @bosonprotocol/x402-example-facilitator-http deploy --legacy /deploy

# --- Stage 3: runtime ---
FROM node:22-alpine AS runtime
WORKDIR /app
COPY --from=build /deploy ./

ENV PORT=8889
EXPOSE 8889
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" >/dev/null || exit 1

USER node
CMD ["node_modules/.bin/tsx", "src/index.ts"]
