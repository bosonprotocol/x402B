# Build context: the repo root.
# Compose reference: `build: { context: ../../, dockerfile: examples/facilitator-http/Dockerfile }`.

FROM node:22-alpine AS builder

RUN apk add --no-cache git
RUN npm install -g pnpm@10.7.0

WORKDIR /repo

# Copy lockfile + workspace manifest first so the install layer caches.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc tsconfig.base.json turbo.json ./

# Copy the manifests of every workspace package so pnpm can resolve the graph.
COPY typescript/packages/core/package.json typescript/packages/core/
COPY typescript/packages/actions/package.json typescript/packages/actions/
COPY typescript/packages/fulfillment/package.json typescript/packages/fulfillment/
COPY typescript/packages/evm/package.json typescript/packages/evm/
COPY typescript/packages/server/package.json typescript/packages/server/
COPY typescript/packages/server-express/package.json typescript/packages/server-express/
COPY typescript/packages/client/package.json typescript/packages/client/
COPY typescript/packages/client-fetch/package.json typescript/packages/client-fetch/
COPY typescript/packages/facilitator/package.json typescript/packages/facilitator/
COPY typescript/packages/facilitator-express/package.json typescript/packages/facilitator-express/
COPY examples/facilitator-http/package.json examples/facilitator-http/
COPY examples/webhook-sink/package.json examples/webhook-sink/

RUN pnpm install --frozen-lockfile

# Copy source + build the workspace deps we'll consume at runtime.
COPY typescript ./typescript
COPY examples/facilitator-http ./examples/facilitator-http
RUN pnpm --filter @bosonprotocol/x402-facilitator-express... build

# Runtime image — same base, copy the built workspace from the builder.
FROM node:22-alpine

RUN npm install -g pnpm@10.7.0
WORKDIR /repo
COPY --from=builder /repo /repo

WORKDIR /repo/examples/facilitator-http

ENV PORT=8889
EXPOSE 8889

CMD ["pnpm", "start"]
