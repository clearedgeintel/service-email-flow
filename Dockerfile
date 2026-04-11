# ============================================================
# ServiceFlow — Multi-stage Docker build
# Default target is "app" (Next.js). Build worker explicitly:
#   docker build --target worker .
# ============================================================

# --- Base ---
FROM node:20-alpine AS base
WORKDIR /app

# --- Dependencies ---
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# --- Build ---
FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- Worker (BullMQ) ---
FROM base AS worker
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 worker

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/src ./src
COPY --from=build /app/node_modules/.package-lock.json ./node_modules/.package-lock.json

# tsx is a devDep — install it in the worker stage
RUN npm install tsx

USER worker
CMD ["npx", "tsx", "--tsconfig", "tsconfig.json", "src/workers/index.ts"]

# --- App (Next.js) — LAST STAGE is the default target for Railway/Docker ---
FROM base AS app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/src ./src

USER nextjs
EXPOSE 3000
# Do NOT hardcode PORT — Railway and other platforms inject their own $PORT env var.
# Next.js `next start` honors $PORT automatically.
ENV HOSTNAME="0.0.0.0"
CMD ["npm", "start"]
