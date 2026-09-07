# Сборка один раз, запуск везде (build once, deploy everywhere)
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json* tsconfig.base.json tsconfig.json ./
COPY apps/api/package.json apps/api/
# Общий пакет: интерфейс модели. Сам клиент запускает мост на машине
# человека, но интерфейс нужен обеим сторонам и обязан быть один (task-001).
COPY packages/model/package.json packages/model/
RUN npm ci
COPY packages/model packages/model
COPY apps/api apps/api
# Именно `tsc --build apps/api`, с явным проектом.
#
# Не `npm run typecheck`: тот проверяет ещё и фронт, которого в этом образе нет.
# И не голое `tsc --build`: без аргумента берётся КОРНЕВОЙ tsconfig.json, а он
# ссылается на все три приложения, включая мост. Моста в образе бека нет и не
# должно быть — он живёт на машине человека. Сборка падала на TS5083
# «Cannot read file /app/apps/bridge/tsconfig.json» с того дня, как мост
# появился, и молчала до первой пересборки. Явный проект тянет за собой
# ровно свои ссылки: packages/model и больше ничего.
RUN npx tsc --build apps/api

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/
COPY packages/model/package.json packages/model/
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/packages/model/dist packages/model/dist
COPY --from=build /app/apps/api/dist apps/api/dist
USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
