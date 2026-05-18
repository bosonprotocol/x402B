# syntax=docker/dockerfile:1.7
#
# Build from the monorepo root so the root pnpm-lock.yaml is in context:
#   docker build -t x402b-e2e-resource-server -f typescript/packages/x402-e2e/src/bin/resource-server.Dockerfile .
#
# Wraps `@bosonprotocol/x402-example-resource-server` with the entrypoint
# in `src/bin/resource-server.ts`, which constructs an `ExchangeReader`
# (the example's own binary refuses to start without one).

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY . .
RUN pnpm install --frozen-lockfile \
    --filter @bosonprotocol/x402-e2e...

# Build the workspace deps the bin entrypoint imports (tsup emits dist/
# + the exports map points at it). The trailing `...` includes the
# transitive workspace chain (x402-core, x402-evm, x402-actions,
# x402-fulfillment, x402-server, x402-server-express, x402-example-resource-server).
RUN pnpm --filter @bosonprotocol/x402-example-resource-server... build

RUN pnpm --filter @bosonprotocol/x402-e2e deploy --legacy /deploy

FROM node:22-alpine AS runtime
WORKDIR /app
COPY --from=deps /deploy ./

ENV PORT=4001
EXPOSE 4001
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" >/dev/null || exit 1

USER node
CMD ["node_modules/.bin/tsx", "src/bin/resource-server.ts"]
