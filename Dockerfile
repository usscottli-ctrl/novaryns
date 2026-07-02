# Novaryns — production image (Next.js standalone).
# Build:  docker build -t novaryns .
# Run:    see docker-compose.yml (recommended: bundles Postgres + data volume)

# ── deps ────────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# ── build ───────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ── runtime ─────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    MEDIA_DIR=/data/media

# Non-root user
RUN groupadd -g 1001 nodejs && useradd -u 1001 -g nodejs -m nextjs

COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

# Local media storage (used when R2 is not configured)
RUN mkdir -p /data/media && chown -R nextjs:nodejs /data
VOLUME /data

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
