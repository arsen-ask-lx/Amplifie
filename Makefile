# Единый интерфейс команд — для человека и для агента.
# Ни одна команда проекта не запускается мимо этого файла.
# .RECIPEPREFIX убирает требование табов: правило начинается с '>'.
.RECIPEPREFIX = >
.DEFAULT_GOAL := help
SHELL := /bin/sh

help: ## показать этот список
> @grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

env: ## создать .env из шаблона, если его нет
> @test -f .env || (cp .env.example .env && echo "создан .env из .env.example")
> @node tools/checks/ensure-secret.mjs

up: env ## поднять весь стек
> docker compose up -d --build
> @echo "ждём здоровья api..."
> @for i in $$(seq 1 30); do \
>   if docker compose ps api --format '{{.Health}}' | grep -q healthy; then echo "готово: http://localhost:$${HTTP_PORT:-8477}/health"; exit 0; fi; \
>   sleep 2; \
> done; echo "api не стал здоровым за 60с — смотри 'make logs'"; exit 1

# ── ДЕВ-РЕЖИМ: ПРАВКА ВИДНА СРАЗУ, БЕЗ ПЕРЕСБОРКИ ──────────────────────
#
# В `make up` фронт СОБРАН И ЗАПЕЧЁН В ОБРАЗ: Caddy отдаёт готовую статику,
# и любая правка требует пересборки образа. Это правильно для стенда и
# невыносимо при работе руками — каждая мелочь стоит минуты.
#
# Здесь фронт поднимается своим сервером на этой машине: правка видна
# в браузере через доли секунды, состояние экрана не теряется. Запросы
# к `/v1` он проксирует на стек, поэтому `make up` всё равно нужен —
# ради базы и бека.
#
# ⚠️ ЭТО НИЖНЯЯ ПОЛОВИНА `make work`, и в одиночку она нужна редко:
# дев-сервер занимает 8477 и не поднимется, пока там Caddy. Обычный вход
# в работу — `make work`, он гасит Caddy сам.

API_URL ?= http://localhost:8477

dev: ## фронт с горячей перезагрузкой (стек уже поднят: make up)
> API_URL=$(API_URL) npm run dev --workspace=@amplifie/frontend

# ⚠️ С ЭТОГО НАЧИНАЕТСЯ РАБОТА, И АДРЕС ТУТ ОДИН — http://localhost:8477
#
# Раньше их было два: 8477 показывал собранное, а горячая перезагрузка
# и «тыкалка» (Alt+щелчок по элементу → замечание в файл) жили на своём
# порту. Владелец сказал прямо: работать надо в одном месте, «там, где
# люди что увидят». Два похожих экрана плодят вопросы вроде «а почему
# тут Alt работает, а там нет», и каждый стоит получаса.
#
# Поэтому Caddy на время работы руками гаснет, и его место занимает
# дев-сервер. Вернуть собранное на тот же адрес — `make up`.
#
# ⚠️ ТЫКАЛКА В ОБРАЗ НЕ ПОПАДАЕТ И НЕ ДОЛЖНА: это оснастка работы,
# а не часть продукта. Значит на собранном стенде Alt не работает —
# и это не поломка, а граница.
work: up ## начать работу: один адрес :8477, горячая перезагрузка и тыкалка
> docker compose stop caddy
> @echo "фронт с тыкалкой поднимается на http://localhost:8477 (Ctrl+C — выйти)"
> @echo "вернуть собранное на тот же адрес: make up"
> API_URL=http://localhost:$${API_HOST_PORT:-3477} npm run dev --workspace=@amplifie/frontend

# То же самое для бека. Node 24 запускает TypeScript сам, поэтому сборка
# не нужна вовсе — только перезапуск на изменение файла.
#
# ⚠️ ГАСИТ КОНТЕЙНЕРЫ api И caddy. Иначе на 3000 их будет двое, а Caddy
# продолжит проксировать на контейнерный. Фронт тогда запускается так:
#   make dev API_URL=http://localhost:3000
# Вернуть всё как было: make up
dev-api: ## бек на этой машине, с перезапуском на каждую правку
> docker compose stop api caddy
> set -a; . ./.env; set +a; DATABASE_URL="postgres://$$POSTGRES_USER:$$POSTGRES_PASSWORD@127.0.0.1:$$POSTGRES_HOST_PORT/$$POSTGRES_DB" API_PORT=3000 npm run dev --workspace=@amplifie/backend

down: ## остановить стек (данные сохраняются)
> docker compose down

reset: ## остановить и СТЕРЕТЬ данные (дев-база)
> docker compose down -v

logs: ## хвост логов всех сервисов
> docker compose logs -f --tail=100

ps: ## что запущено
> docker compose ps

health: ## дёрнуть /health как пользователь (не test client)
> curl -fsS http://localhost:$${HTTP_PORT:-8477}/health && echo

# ⚠️ ЗАПУСКАЕТСЯ РУКАМИ И РЕДКО. Переносчик читает файл ЧУЖОГО проекта
# с чужой машины: путь у каждого свой, и вшивать его сюда нельзя.
# Значения после переноса живут у нас числами в `frontend/src/themes.css`,
# поэтому сборке он не нужен вовсе.
themes: ## перенести темы из audit_project (PATH=... путь к их site-theme.tokens.css)
> node tools/dev/import-themes.mjs "$(PATH_TO_THEMES)" > frontend/src/themes.css
> @echo "перенесено; проверь: make contrast"

demo: ## завести демо-канал с диалогом (дев-данные, стираются make reset)
> docker compose exec -T postgres psql -U $${POSTGRES_USER:-amplifie} -d $${POSTGRES_DB:-amplifie} -v ON_ERROR_STOP=1 -f - < tools/dev/demo.sql

psql: ## консоль базы
> docker compose exec postgres psql -U $${POSTGRES_USER:-amplifie} -d $${POSTGRES_DB:-amplifie}

install: ## поставить зависимости локально (для типов и линтера)
> npm install

# ⚠️ ЧИТАЕТ .env, А НЕ ГАДАЕТ. Здесь стояли значения по умолчанию, и порт
# в них давно разошёлся с настоящим: команда молча ходила не туда и падала
# с невнятным «applying migrations...». Умолчаний у адреса базы быть
# не должно — он либо известен, либо команду запускать нельзя.
migrate: ## применить миграции к базе
> set -a; . ./.env; set +a; cd backend && DATABASE_URL="postgres://$$POSTGRES_USER:$$POSTGRES_PASSWORD@127.0.0.1:$$POSTGRES_HOST_PORT/$$POSTGRES_DB" npx drizzle-kit migrate

migrate-new: ## сгенерировать миграцию из схемы (SQL потом читать и править руками)
> cd backend && npx drizzle-kit generate

typecheck: ## проверка типов
> npm run typecheck

lint: ## формат + линтер (проверка)
> npm run lint

format: ## формат + линтер (с исправлением)
> npm run format

arch: ## архитектурные границы (запреты импортов)
> npm run arch

decisions: ## решения приняты с источниками, а не по памяти
> npm run decisions

rhythm: ## отступы стоят на сетке в 4 пикселя
> node tools/checks/check-rhythm.mjs

contrast: ## контраст пар цветов в обеих темах (WCAG)
> npm run contrast

unit: ## быстрые проверки чистых функций (без стека)
> npm run unit

no-raw-html: ## запрет вставки сырого HTML в интерфейс (Р-002)
> npm run no-raw-html

failure-map: ## код отказа разбирается в одном слое, а не по экранам
> npm run failure-map

stages: ## список стадий задачи совпадает с CHECK в базе
> npm run stages

favicon: ## знак на вкладке не разошёлся со знаком в интерфейсе
> npm run favicon

model: ## спросить подключённую модель вживую (не гейт, а проверка связи)
> npm run model

duplicates: ## повторы в прод-коде под храповиком
> npm run duplicates

gates: ## вшитые записи каталога AQK (размер файла, TODO, ссылки, мёртвый код, цвет…)
> npm run gates

arbiter-check: ## проверки самого счётчика согласия (числа посчитаны руками)
> npm run arbiter:check

arbiter: ## отчёт арбитра К2 — согласие людей и число агента
> npm run arbiter

label: ## выпустить лист второй разметки К2 (правится в редакторе)
> npm run label

ci-gates: ## гейты каталога AQK, поставленные пакетом (образцы — в tools/gates/)
> bash tools/gates/gates-run-in-ci/check.sh .
> bash tools/gates/personal-config-not-shared/check.sh .

aqk: ## ступень соответствия AQK и что до следующей
> npx --yes agent-quality-kit@0.7.0 doctor

test: ## приёмочные тесты по ЖИВОМУ стеку (сначала: make up)
> npm test

# ⚠️ УСТАНОВКА БРАУЗЕРА СТОИТ ЗДЕСЬ, А НЕ В ЧЬЕЙ-ТО ПАМЯТИ. Самая частая
# поломка Playwright у других — версия пакета уехала, браузеры остались
# старые, и прогон падает «нет браузера» на исправном коде. Команда
# доводит браузер до версии пакета сама; уже стоящий не перекачивается.
#
# ⚠️ ВНЕ `make check`. Быстрым проверкам нельзя требовать поднятого стека
# и браузера — иначе их перестают гонять. Тот же довод, что у `make test`.
test-ui: ## проверки интерфейса настоящим браузером (сначала: make up)
# ⚠️ ПОДНИМАЕМ CADDY ОБРАТНО, И ЭТО НЕ ПЕРЕСТРАХОВКА. Проверки обязаны
# бить по СОБРАННОМУ образу (Р-022): по нему уедет к людям, и только он
# ловит поломки сборки. Забыл после `make work` — и проверки молча
# прошли бы по дев-сборке, то есть арбитр соврал бы, а это худший
# вид отказа (см. инцидент с заглушкой в Caddyfile).
> @docker compose up -d caddy || (echo ""; echo "8477 занят дев-сервером: погаси его (Ctrl+C в окне make work) и повтори."; exit 1)
> npx playwright install chromium
> npm run test-ui

check: lint typecheck arch decisions contrast rhythm unit no-raw-html failure-map stages favicon duplicates gates ci-gates arbiter-check model ## всё быстрое разом — то же, что гоняет CI
> @echo "все быстрые проверки прошли"

.PHONY: help env up work dev dev-api down reset logs ps health demo themes psql install migrate migrate-new typecheck lint format arch decisions contrast rhythm unit no-raw-html failure-map stages favicon duplicates gates ci-gates arbiter-check model arbiter label aqk test test-ui check
