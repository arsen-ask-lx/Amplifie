# Собираем статику и кладём её в образ вместе с прокси.
# Отдельного сервера у фронта нет — минус один узел по Люссеру.
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY tools/tsconfig.base.json tools/
COPY frontend/package.json frontend/
COPY packages/contract packages/contract
RUN npm ci --workspace=@amplifie/frontend --include-workspace-root
COPY frontend frontend
RUN npx tsc -p frontend --noEmit && npm run build --workspace=@amplifie/frontend

FROM caddy:2-alpine AS runtime
COPY --from=build /app/frontend/dist /srv
COPY frontend/Caddyfile /etc/caddy/Caddyfile
