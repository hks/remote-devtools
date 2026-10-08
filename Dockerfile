# Remote DevTools — relay + build edilmiş web arayüzü (tek imaj)
# Node 24 .ts dosyalarını type stripping ile doğrudan çalıştırır; relay için build adımı yok.

FROM node:24.11.0-alpine AS web-build
WORKDIR /app
COPY shared ./shared
COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci
COPY web ./web
RUN cd web && npm run build

FROM node:24.11.0-alpine AS relay-deps
WORKDIR /app/relay
COPY relay/package.json relay/package-lock.json ./
RUN npm ci --omit=dev

FROM node:24.11.0-alpine
ENV NODE_ENV=production \
    PORT=8080 \
    WEB_DIST_DIR=/app/web/dist
WORKDIR /app
COPY shared ./shared
COPY --from=relay-deps /app/relay/node_modules ./relay/node_modules
COPY relay/package.json ./relay/
COPY relay/src ./relay/src
COPY --from=web-build /app/web/dist ./web/dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
    CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "relay/src/main.ts"]
