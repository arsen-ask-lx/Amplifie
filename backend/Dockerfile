# Сборка один раз, запуск везде (build once, deploy everywhere)
#
# ⚠️ БАЗОВЫЙ ОБРАЗ — ТОЧНАЯ ВЕРСИЯ И ОТПЕЧАТОК (task-118, Д-36); тот же,
# что в `frontend/Dockerfile` и `Makefile`. Обновление — правка строки
# и `make delivery`.
ARG NODE_IMAGE=node:26.10.0-bookworm-slim@sha256:662933cf47f013bc8e4beb31a6116448427a82057ba7c42c97e4c5ba766504c2

FROM ${NODE_IMAGE} AS build
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
# Мост ЗАПУСКАЕТСЯ на машине человека, но РАЗДАЁТСЯ отсюда: бек отдаёт его
# одним архивом, и строка с сайта ставит его `npx` из любой папки (task-065).
COPY bridge/package.json bridge/
# Пакеты — из кеша сборщика: повторная сборка на той же машине их не качает.
RUN --mount=type=cache,target=/root/.npm npm ci
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
COPY bridge bridge
RUN npm run bridge:pack

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production

# ⚠️ ВЕРСИЯ ВПЕКАЕТСЯ В ОБРАЗ, А НЕ ПРИХОДИТ ПРИ ЗАПУСКЕ (Р-030 ⑥).
#
# Если бы она передавалась переменной в `compose.yml`, клиент, поднявший
# установку без этой переменной, увидел бы «версия не задана» — при том
# что у него на диске лежит совершенно определённый образ. Версия — свойство
# АРТЕФАКТА, и жить она обязана внутри него.
#
# Источник — тег git: единственное, что невозможно забыть обновить, потому
# что он и есть акт выпуска. Пусто — значит собрано мимо выпуска, и `/health`
# скажет об этом прямо, а не выдумает «dev».
ARG AMPLIFIE_VERSION=""
ENV AMPLIFIE_VERSION=$AMPLIFIE_VERSION
LABEL org.opencontainers.image.title="amplifie-api"       org.opencontainers.image.version="$AMPLIFIE_VERSION"
COPY package.json package-lock.json* ./
COPY backend/package.json backend/
COPY packages/model/package.json packages/model/
COPY packages/contract/package.json packages/contract/
# Кеш — в монтировании, в слой он не попадает; `npm cache clean` здесь
# чистил бы общий кеш сборщика на каждой сборке.
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev
COPY --from=build /app/packages/model/dist packages/model/dist
COPY --from=build /app/packages/contract/dist packages/contract/dist
COPY --from=build /app/backend/dist backend/dist
COPY --from=build /app/bridge/package/amplifie-bridge.tgz bridge/package/
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
