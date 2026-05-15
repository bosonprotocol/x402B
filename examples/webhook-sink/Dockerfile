FROM node:22-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=optional --no-audit --no-fund

COPY src ./src

ENV PORT=4000
EXPOSE 4000

CMD ["npx", "tsx", "src/index.ts"]
FROM node:22-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=optional --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src

ENV PORT=4000
EXPOSE 4000

USER node
CMD ["npx", "tsx", "src/index.ts"]
