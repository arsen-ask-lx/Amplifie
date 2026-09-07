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

up: env ## поднять весь стек
> docker compose up -d --build
> @echo "ждём здоровья api..."
> @for i in $$(seq 1 30); do \
>   if docker compose ps api --format '{{.Health}}' | grep -q healthy; then echo "готово: http://localhost:$${HTTP_PORT:-8477}/health"; exit 0; fi; \
>   sleep 2; \
> done; echo "api не стал здоровым за 60с — смотри 'make logs'"; exit 1

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

psql: ## консоль базы
> docker compose exec postgres psql -U $${POSTGRES_USER:-amplifie} -d $${POSTGRES_DB:-amplifie}

install: ## поставить зависимости локально (для типов и линтера)
> npm install

migrate: ## применить миграции к базе
> cd backend && DATABASE_URL="postgres://$${POSTGRES_USER:-amplifie}:$${POSTGRES_PASSWORD:-amplifie_dev_only}@127.0.0.1:$${POSTGRES_HOST_PORT:-54477}/$${POSTGRES_DB:-amplifie}" npx drizzle-kit migrate

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

model: ## спросить подключённую модель вживую (не гейт, а проверка связи)
> npm run model

gates: ## вшитые записи каталога AQK (размер файла, TODO, ссылки, версии)
> npm run gates

arbiter-check: ## проверки самого счётчика согласия (числа посчитаны руками)
> npm run arbiter:check

arbiter: ## отчёт арбитра К2 — согласие людей и число агента
> npm run arbiter

label: ## выпустить лист второй разметки К2 (правится в редакторе)
> npm run label

aqk: ## ступень соответствия AQK и что до следующей
> npx --yes agent-quality-kit@0.4.2 doctor

test: ## приёмочные тесты по ЖИВОМУ стеку (сначала: make up)
> npm test

check: lint typecheck arch decisions contrast rhythm unit no-raw-html gates arbiter-check model ## всё быстрое разом — то же, что гоняет CI
> @echo "все быстрые проверки прошли"

.PHONY: help env up down reset logs ps health psql install migrate migrate-new typecheck lint format arch decisions contrast rhythm unit no-raw-html gates arbiter-check model arbiter label aqk test check
