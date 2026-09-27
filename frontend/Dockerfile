# Собираем статику и кладём её в образ вместе с прокси.
# Отдельного сервера у фронта нет — минус один узел по Люссеру.
#
# ⚠️ БАЗОВЫЕ ОБРАЗЫ — ТОЧНАЯ ВЕРСИЯ И ОТПЕЧАТОК (task-118, Д-36). Плавающий
# тег давал два разных образа из одного коммита: клиент не мог ответить,
# какой Caddy у него внутри. Отпечаток — многоархитектурного индекса, не
# одной платформы: иначе сервер на arm64 не соберёт. Обновление — правка
# этих строк и `make delivery`; тот же Node — в `backend/Dockerfile` и
# `Makefile` (`NODE_IMAGE`).
#
# Строки `# syntax=` нет намеренно: кеш-монтирования BuildKit понимает сам,
# а плавающая `docker/dockerfile:1` — ещё один сдвигающийся тег и поход
# в реестр на каждой сборке.
ARG NODE_IMAGE=node:26.10.0-bookworm-slim@sha256:662933cf47f013bc8e4beb31a6116448427a82057ba7c42c97e4c5ba766504c2
ARG CADDY_IMAGE=caddy:2.11.4-alpine@sha256:6aeddd44c3078b0f9a35206472a11420648a79c184603ef95957d0a20044cb2b

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY tools/tsconfig.base.json tools/
# ⚠️ ДЕВ-ОСНАСТКА НУЖНА ДАЖЕ ПРОДУКТОВОЙ СБОРКЕ, И ЭТО НЕ ЛИШНИЙ СЛОЙ.
# `vite.config.ts` подключает «тыкалку» ОБЫЧНЫМ импортом, а конфигурация
# читается целиком до того, как становится известен режим. Нет файла —
# сборка падает на разборе конфигурации, ещё не дойдя до кода.
#
# Найдено дорого: образ не собирался с самого появления тыкалки, а
# `docker compose up -d --build` при неудачной сборке ОСТАВЛЯЕТ РАБОТАТЬ
# СТАРЫЙ КОНТЕЙНЕР. Снаружи это выглядело как «пересобрал, а изменений
# нет» — четыре раза подряд. См. dock/incidents.
#
# В готовый образ этот слой не попадает: наружу уходит только dist.
COPY tools/dev tools/dev
# ⚠️ УСТАНОВКА БЕЗ ФИЛЬТРА ПО РАБОЧЕЙ ОБЛАСТИ, И ЭТО НЕ ЛЕНЬ.
#
# Было `npm ci --workspace=@amplifie/frontend`. С приходом Tailwind сборка
# слегла: «Cannot find module '@tailwindcss/oxide-linux-x64-gnu'». Замок
# версий линуксовый двоичный файл содержит — его пропускает сама фильтрация
# по рабочей области (npm/cli#4828: при `--workspace` необязательные
# зависимости по платформе теряются).
#
# Поэтому ставим всё и копируем ВСЕ объявления рабочих областей: без них
# `npm ci` откажется — замок описывает область целиком, а не по кускам.
# Лишние зависимости остаются в слое сборки и в готовый образ не попадают:
# наружу уходит только `dist` в контейнере с Caddy.
COPY frontend/package.json frontend/
COPY backend/package.json backend/
COPY bridge/package.json bridge/
COPY packages/model/package.json packages/model/
COPY packages/contract packages/contract
# Пакеты — из кеша сборщика, если он есть: на машине разработчика повторная
# сборка не качает их заново. В конвейере раннер свежий, выигрыша там нет.
RUN --mount=type=cache,target=/root/.npm npm ci
COPY frontend frontend
RUN npx tsc -p frontend --noEmit && npm run build --workspace=@amplifie/frontend

FROM ${CADDY_IMAGE} AS runtime
# Метка, а не переменная: у статики спрашивать версию некому — на вопрос
# «что у вас стоит» отвечает `/health` бека. Метка нужна тому, кто разбирает
# образы на диске у клиента.
ARG AMPLIFIE_VERSION=""
LABEL org.opencontainers.image.title="amplifie-web"       org.opencontainers.image.version="$AMPLIFIE_VERSION"

# ⚠️ НЕ ОТ ROOT (task-118, Д-63). Коробка стоит на чужом сервере: дыра
# в веб-сервере не должна давать права администратора контейнера. 80-й порт
# слушается без root: бинарнику Caddy право `cap_net_bind_service` выдано
# самим образом (`getcap`, проверено 27.09). В compose у него срезаны все
# прочие права — остаётся только это одно.
#
# /data и /config — его: там сертификаты и сохранённая настройка. Новый том
# Docker заводит с этим владельцем; старый том стенда — `make caddy-volume`.
RUN addgroup -S -g 10001 amplifie && adduser -S -D -H -u 10001 -G amplifie amplifie   && chown -R 10001:10001 /data /config
WORKDIR /srv
COPY --from=build --chown=10001:10001 /app/frontend/dist /srv
COPY frontend/Caddyfile /etc/caddy/Caddyfile
USER 10001:10001
EXPOSE 80
