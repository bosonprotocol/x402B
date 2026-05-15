FROM node:22-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=optional --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src

ENV PORT=4000
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" >/dev/null || exit 1

USER node
CMD ["npx", "tsx", "src/index.ts"]
