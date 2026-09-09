# Сборка один раз, запуск везде (build once, deploy everywhere)
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json* tsconfig.json ./
COPY tools/tsconfig.base.json tools/
COPY backend/package.json backend/
# Общий пакет: интерфейс модели. Сам клиент запускает мост на машине
# человека, но интерфейс нужен обеим сторонам и обязан быть один (task-001).
COPY packages/model/package.json packages/model/
# Общее знание бека и фронта: стадии задачи и размыкатель (task-012).
# Не «удобно переиспользовать», а «обе стороны обязаны понимать одинаково».
COPY packages/contract/package.json packages/contract/
RUN npm ci
COPY packages/model packages/model
COPY packages/contract packages/contract
COPY backend backend
# Именно `tsc --build backend`, с явным проектом.
#
# Не `npm run typecheck`: тот проверяет ещё и фронт, которого в этом образе нет.
# И не голое `tsc --build`: без аргумента берётся КОРНЕВОЙ tsconfig.json, а он
# ссылается на все три приложения, включая мост. Моста в образе бека нет и не
# должно быть — он живёт на машине человека. Сборка падала на TS5083
# «Cannot read file /app/bridge/tsconfig.json» с того дня, как мост
# появился, и молчала до первой пересборки. Явный проект тянет за собой
# ровно свои ссылки: packages/model, packages/contract — и больше ничего.
RUN npx tsc --build backend

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
COPY backend/package.json backend/
COPY packages/model/package.json packages/model/
COPY packages/contract/package.json packages/contract/
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/packages/model/dist packages/model/dist
COPY --from=build /app/packages/contract/dist packages/contract/dist
COPY --from=build /app/backend/dist backend/dist
# ⚠️ ФАЙЛЫ МИГРАЦИЙ ЕДУТ В ОБРАЗ, И БЕЗ НИХ КОРОБКУ НЕЛЬЗЯ ОБНОВИТЬ (Р-030 ③).
#
# До этой строки образ вёз только `dist`, а накатывать миграции предлагалось
# `drizzle-kit`-ом с хоста — то есть инструментом разработки, которого в образе
# нет, и по адресу, которого у клиента нет. Обещание Р-024 «миграции
# накатываются сами» не выполнялось ни одним из своих слов.
#
# Сам накатыватель — вторая точка входа этого же образа (`migrate.js`),
# а не отдельный образ: один артефакт, две команды.
COPY --from=build /app/backend/migrations backend/migrations
USER node
EXPOSE 3000
CMD ["node", "backend/dist/main.js"]
