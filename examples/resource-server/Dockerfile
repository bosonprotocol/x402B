# syntax=docker/dockerfile:1.7
#
# Build from the monorepo root so the root pnpm-lock.yaml is in context:
#   docker build -t x402b-resource-server -f examples/resource-server/Dockerfile .
#
# corepack reads `packageManager` from the root package.json and pins pnpm.

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY . .
RUN pnpm install --frozen-lockfile \
    --filter @bosonprotocol/x402-example-resource-server...

# Build the workspace deps the example imports (tsup emits dist/ + the
# exports map points at it). The trailing `...` includes transitive
# workspace deps (x402-core, x402-evm, x402-actions, x402-fulfillment,
# x402-server).
RUN pnpm --filter @bosonprotocol/x402-server-express... build

# See examples/webhook-sink/Dockerfile for the rationale behind
# `pnpm deploy --legacy` (flattens the virtual store into a self-contained
# dir; --legacy keeps the pnpm-9 deploy semantics).
RUN pnpm --filter @bosonprotocol/x402-example-resource-server deploy --legacy /deploy

FROM node:22-alpine AS runtime
WORKDIR /app
COPY --from=deps /deploy ./

ENV PORT=4001
EXPOSE 4001
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" >/dev/null || exit 1

USER node
CMD ["node_modules/.bin/tsx", "src/index.ts"]
