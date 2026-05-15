# syntax=docker/dockerfile:1.7
#
# Build from the monorepo root so the root pnpm-lock.yaml is in context:
#   docker build -t x402b-facilitator-http -f examples/facilitator-http/Dockerfile .
#
# corepack reads `packageManager` from the root package.json and pins pnpm.

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY . .
RUN pnpm install --frozen-lockfile \
    --filter @bosonprotocol/x402-example-facilitator-http...

# Build the workspace deps the example imports (tsup emits dist/ + the
# exports map points at it). The trailing `...` includes transitive
# workspace deps (x402-core, x402-evm, x402-actions, x402-fulfillment).
RUN pnpm --filter @bosonprotocol/x402-facilitator-express... build

# See examples/webhook-sink/Dockerfile for the rationale behind
# `pnpm deploy --legacy` (flattens the virtual store into a self-contained
# dir; --legacy keeps the pnpm-9 deploy semantics).
RUN pnpm --filter @bosonprotocol/x402-example-facilitator-http deploy --legacy /deploy

FROM node:22-alpine AS runtime
WORKDIR /app
COPY --from=deps /deploy ./

ENV PORT=8889
EXPOSE 8889
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" >/dev/null || exit 1

USER node
CMD ["npx", "tsx", "src/index.ts"]
