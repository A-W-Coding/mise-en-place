# Production image for the API. Build it on the Pi, where it's natively arm64.
# The image doesn't run migrations itself: scripts/deploy.sh runs
# `prisma migrate deploy` with it before the new version starts.

# ── Build stage ──────────────────────────────────────────────
FROM node:22-slim AS build

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx --no prisma generate

COPY tsconfig.json ./
COPY shared ./shared
COPY src ./src
RUN npm run build

# ── Web client stage ─────────────────────────────────────────
# web/ is its own npm project. Only its built files reach the final image;
# its dependencies stay behind in this stage.
FROM node:22-slim AS web

WORKDIR /app

COPY web/package.json web/package-lock.json ./web/
RUN npm --prefix web ci

COPY shared ./shared
COPY web ./web
RUN npm --prefix web run build

# ── Production stage ─────────────────────────────────────────
FROM node:22-slim

# Prisma's engines need OpenSSL
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# No npm update check when deploy.sh runs `npx prisma` in this image
ENV NODE_ENV=production NPM_CONFIG_UPDATE_NOTIFIER=false
WORKDIR /app

# The Prisma CLI is a production dependency, so `migrate deploy` works here
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/dist ./dist
# The API serves these from web/dist, under the working directory (F1)
COPY --from=web /app/web/dist ./web/dist
COPY prisma ./prisma

# Everything above is owned by root and only readable by the app
USER node

EXPOSE 3000

CMD ["node", "dist/src/server.js"]
