# Novaryns — production image (Next.js standalone).
# Build:  docker build -t novaryns .
# Run:    see docker-compose.yml (recommended: bundles Postgres + data volume)

# ── deps ────────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# npm 源可配置。**默认保持官方源,行为与原来一致**;国内机器构建时传
#   --build-arg NPM_REGISTRY=https://registry.npmmirror.com
# 2026-08-17 事故:杭州 ECS 到 registry.npmjs.org 超时(curl 15s 拿到 0 字节),
# `npm ci` 在容器里静默挂死 —— 表现为 docker build 停在这一步、CPU 占用为零、
# 日志再不输出,极像"构建很慢",实际是永远不会结束。宿主机 npm run build 照样成功
# (node_modules 已在本地不需联网),所以主站没事、只有租户开通/升级会挂。
ARG NPM_REGISTRY=https://registry.npmjs.org
RUN npm config set registry "$NPM_REGISTRY" \
 && npm ci --fetch-timeout=120000 --fetch-retries=3

# ── build ───────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# 可选:接自托管 GoTrue/Supabase 认证时按实例传入(NEXT_PUBLIC_* 是构建期内联,
# 运行时 env 无效)。留空 = 单机模式(默认),与原行为完全一致。
ARG NEXT_PUBLIC_SUPABASE_URL=
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY=
# 图片 CDN 改写域名。**国内实例(含云端租户)必须传** —— 不传则 cdnUrl() 是空操作,
# 图片以原始 *.r2.dev 地址交给浏览器,而 r2.dev 在国内没有可靠边缘节点:
# 服务器 curl 能取、浏览器加载不出来,表现为作品卡片全塌。
# 海外实例留空 = no-op,直连 R2(出流量免费),与原行为一致。
ARG NEXT_PUBLIC_IMAGE_BASE_URL=
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_IMAGE_BASE_URL=$NEXT_PUBLIC_IMAGE_BASE_URL \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ── runtime ─────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runner
WORKDIR /app
# 构建版本号(CI 传入 date +%s):后台"检查更新"用它跟官方站比对。
ARG BUILD_VERSION=0
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    MEDIA_DIR=/data/media \
    BUILD_VERSION=$BUILD_VERSION

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
