# syntax=docker/dockerfile:1.7
#
# Build from the monorepo root so the root pnpm-lock.yaml is in context:
#   docker build -t x402b-webhook-sink -f examples/webhook-sink/Dockerfile .
#
# corepack reads `packageManager` from the root package.json and pins pnpm.

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY . .
RUN pnpm install --frozen-lockfile \
    --filter @bosonprotocol/x402-example-webhook-sink...

# `pnpm deploy` materializes a self-contained directory with a flat
# node_modules — required because the workspace install uses a virtual
# store, and the symlinks under examples/webhook-sink/node_modules point
# back into /repo/node_modules/.pnpm/... which wouldn't exist in the
# runtime stage. --legacy keeps the pnpm-9 behavior (includes
# devDependencies so `tsx` is available at runtime).
RUN pnpm --filter @bosonprotocol/x402-example-webhook-sink deploy --legacy /deploy

FROM node:22-alpine AS runtime
WORKDIR /app
COPY --from=deps /deploy ./

ENV PORT=4000
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" >/dev/null || exit 1

USER node
CMD ["npx", "tsx", "src/index.ts"]
