# Собираем статику и кладём её в образ вместе с прокси.
# Отдельного сервера у фронта нет — минус один узел по Люссеру.
FROM node:24-bookworm-slim AS build
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
RUN npm ci
COPY frontend frontend
RUN npx tsc -p frontend --noEmit && npm run build --workspace=@amplifie/frontend

FROM caddy:2-alpine AS runtime
COPY --from=build /app/frontend/dist /srv
COPY frontend/Caddyfile /etc/caddy/Caddyfile
