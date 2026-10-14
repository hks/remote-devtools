# Remote DevTools — relay + build edilmiş UI (tek imaj)
# Build context repo köküdür: `docker build -f apps/server/Dockerfile .` (compose bunu kendisi ayarlar).
# Relay esbuild ile tek dosyaya paketlenir; çalışma imajında node_modules yoktur.

FROM node:24.11.0-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/protocol/package.json ./packages/protocol/
COPY packages/relay/package.json ./packages/relay/
COPY packages/ui/package.json ./packages/ui/
RUN pnpm install --frozen-lockfile
COPY packages ./packages
RUN pnpm --filter @remote-devtools/relay --filter @remote-devtools/ui build

FROM node:24.11.0-alpine
ENV NODE_ENV=production \
    PORT=8080 \
    WEB_DIST_DIR=/app/ui
WORKDIR /app
COPY --from=build /app/packages/relay/dist ./relay
COPY --from=build /app/packages/ui/dist ./ui
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
    CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "relay/main.js"]
