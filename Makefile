# Единый интерфейс команд — для человека и для агента.
# Ни одна команда проекта не запускается мимо этого файла.
# .RECIPEPREFIX убирает требование табов: правило начинается с '>'.
.RECIPEPREFIX = >
.DEFAULT_GOAL := help
# На Linux/macOS POSIX-shell уже лежит в стандартном месте. Windows-версия
# GNU Make превращает `/bin/sh` в `sh.exe` и ищет его только в PATH, хотя Git
# Bash обычно установлен, но в PATH не добавлен. Все рецепты ниже — POSIX;
# указываем один настоящий shell, иначе часть команд незаметно исполняет cmd.
ifeq ($(OS),Windows_NT)
SHELL := C:/PROGRA~1/Git/bin/sh.exe
else
SHELL := /bin/sh
endif

# ⚠️ НАШ СТЕНД ПОДКЛЮЧАЕТСЯ ЯВНО, И ЭТО ЕДИНСТВЕННОЕ МЕСТО, ГДЕ ОБ ЭТОМ
# СКАЗАНО (Р-030 ①).
#
# `compose.yml` описывает УСТАНОВКУ КЛИЕНТА: ни портов наружу, ни сборки,
# ни разрешения заводить чужие компании. Всё наше — в `compose.dev.yml`.
#
# Имя дев-файла нарочно не `override`: такое Compose подхватывает сам,
# и тогда любой, у кого файл окажется рядом, молча получил бы наши
# настройки. Здесь подключение видно глазами и живёт в одной строке.
#
# Проверить, что достаётся клиенту:  docker compose -f compose.yml config
COMPOSE := docker compose -f compose.yml -f compose.dev.yml

# ⚠️ ВЕРСИЯ БЕРЁТСЯ ИЗ ТЕГА GIT, И БОЛЬШЕ НИОТКУДА (Р-030 ⑥).
#
# Поля `version` в `package.json` нарочно нет: их четыре штуки, они разъедутся,
# и понадобится пятый гейт, стерегущий их совпадение. Тег невозможно забыть
# обновить — он и есть акт выпуска.
#
# Тега ещё нет — `--always` отдаёт короткий хеш, `--dirty` дописывает пометку
# о несохранённых правках. Это честнее пустоты: «собрано из такого-то
# состояния» — ровно то, что нужно поддержке.
export AMPLIFIE_VERSION := $(shell git describe --tags --always --dirty 2>/dev/null)

# ⚠️ ИМЕНА ОБРАЗОВ СТЕНДА — ЗДЕСЬ, А НЕ В compose.yml (task-118). Там у них
# нет значения по умолчанию: `latest` отдавал клиенту что угодно с диска.
# `?=` — чтобы сборка выпуска могла назвать свои.
export AMPLIFIE_IMAGE_API ?= amplifie/api:dev
export AMPLIFIE_IMAGE_WEB ?= amplifie/web:dev

# Тот же Node, что в Dockerfile, — для замка версий (deps-lock).
NODE_IMAGE := node:26.10.0-bookworm-slim@sha256:662933cf47f013bc8e4beb31a6116448427a82057ba7c42c97e4c5ba766504c2

help: ## показать этот список
> @grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

env: hooks ## создать .env стенда из шаблона, если его нет
> @node tools/ops/make-env.mjs dev

# ⚠️ ЭТО НАСТРОЙКИ НАСТОЯЩЕЙ УСТАНОВКИ, А НЕ КОПИЯ ОБРАЗЦА (Р-030 ⑤).
#
# `.env.example` копировать клиенту НЕЛЬЗЯ: там слабый пароль,
# `NODE_ENV=development` и разрешение заводить много компаний — то есть дыра,
# при которой любой, знающий адрес, поднимает на чужом сервере свою компанию.
#
# Здесь всё рождается своё: случайный пароль базы, случайный мастер-ключ,
# боевой режим, и строки `AMPLIFIE_MULTI_WORKSPACE` нет вовсе.
#
# ⚠️ СУЩЕСТВУЮЩИЙ .env НЕ ПЕРЕЗАПИСЫВАЕТСЯ. Перезапись выдала бы НОВЫЙ
# мастер-ключ, а с ним пропали бы все сохранённые ключи моделей: восстановления
# нет и быть не может (Р-016).
env-box: ## настройки настоящей установки: всё своё, ничего дев-ового
> @node tools/ops/make-env.mjs box

env-check: ## проверки самого генератора настроек (подсаженное нарушение)
> npm run env:check

# ⚠️ ХУКИ ЖИВУТ В РЕПОЗИТОРИИ, НО НЕ ВКЛЮЧАЮТСЯ САМИ. Git берёт их из
# `.git/hooks`, куда содержимое репозитория не попадает, — поэтому нужен
# `core.hooksPath`. Настройка местная, в git не хранится: на новой машине
# её надо поставить заново, и делает это `make env`, то есть первый же
# `make up`. Иначе хук был бы обещанием, которое не исполняется.
hooks: ## включить хуки git из .githooks (карта проекта и цикл на коммите)
> @if [ -d .git ]; then git config core.hooksPath .githooks && echo "хуки включены: .githooks"; else echo "не репозиторий git — хуки не включены"; fi

wait-api:
> @echo "ждём здоровья api..."
> @for i in $$(seq 1 30); do \
>   if $(COMPOSE) ps api --format '{{.Health}}' | grep -q healthy; then echo "готово: http://localhost:$${HTTP_PORT:-8477}/health"; exit 0; fi; \
>   sleep 2; \
> done; echo "api не стал здоровым за 60с — смотри 'make logs'"; exit 1

up: env ## поднять весь собранный стенд
> $(COMPOSE) up -d --build
> @$(MAKE) wait-api

# ── ДЕВ-РЕЖИМ: ПРАВКА ВИДНА СРАЗУ, БЕЗ ПЕРЕСБОРКИ ──────────────────────
#
# В `make up` фронт СОБРАН И ЗАПЕЧЁН В ОБРАЗ: Caddy отдаёт готовую статику,
# и любая правка требует пересборки образа. Это правильно для стенда и
# невыносимо при работе руками — каждая мелочь стоит минуты.
#
# Здесь фронт поднимается своим сервером на этой машине: правка видна
# в браузере через доли секунды, состояние экрана не теряется. Запросы
# к `/v1` он проксирует на уже поднятые базу и API. Первый запуск после
# свежего клона честно требует `make up`: dev-режим не прячет сборку образа.
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
dev-deps: env
> $(COMPOSE) up -d postgres api
> @$(MAKE) wait-api

work: dev-deps ## начать работу: один адрес :8477, горячая перезагрузка и тыкалка
> $(COMPOSE) stop caddy
> @echo "фронт с тыкалкой поднимается на http://localhost:8477 (Ctrl+C — выйти)"
> @echo "проверить режим: make dev-status; вернуть собранное: make up"
> API_URL=http://localhost:$${API_HOST_PORT:-3477} npm run dev --workspace=@amplifie/frontend

# То же самое для бека. Node 24 запускает TypeScript сам, поэтому сборка
# не нужна вовсе — только перезапуск на изменение файла.
#
# ⚠️ ГАСИТ КОНТЕЙНЕРЫ api И caddy. Иначе на 3000 их будет двое, а Caddy
# продолжит проксировать на контейнерный. Фронт тогда запускается так:
#   make dev API_URL=http://localhost:3000
# Вернуть всё как было: make up
dev-api: ## бек на этой машине, с перезапуском на каждую правку
> $(COMPOSE) stop api caddy
> set -a; . ./.env; set +a; DATABASE_URL="postgres://$$POSTGRES_USER:$$POSTGRES_PASSWORD@127.0.0.1:$$POSTGRES_HOST_PORT/$$POSTGRES_DB" API_PORT=3000 npm run dev --workspace=@amplifie/backend

down: ## остановить стек (данные сохраняются)
> $(COMPOSE) down

reset: ## остановить и СТЕРЕТЬ данные (дев-база)
> $(COMPOSE) down -v

# ⚠️ СТАРЫЙ ТОМ CADDY ПРИНАДЛЕЖИТ ROOT, А CADDY ТЕПЕРЬ НЕ ROOT (task-118).
# Он стартует и отвечает — ошибка видна только в журнале, а проявится
# в день выхода на домен: сертификат некуда записать. Разово на стенде
# и на установке, поднятой до task-118; данные не трогаются.
caddy-volume: ## отдать том Caddy его пользователю (разово, для установок до task-118)
> MSYS_NO_PATHCONV=1 docker run --rm -v $${CADDY_VOLUME:-amplifie_caddy_data}:/data --user 0 caddy:2.11.4-alpine@sha256:6aeddd44c3078b0f9a35206472a11420648a79c184603ef95957d0a20044cb2b chown -R 10001:10001 /data
> @echo "том Caddy отдан пользователю 10001"

logs: ## хвост логов всех сервисов
> $(COMPOSE) logs -f --tail=100

ps: ## что запущено
> $(COMPOSE) ps

health: ## дёрнуть /health как пользователь (не test client)
> curl -fsS http://localhost:$${HTTP_PORT:-8477}/health && echo

dev-status: ## показать, кто отвечает на :8477 и доступен ли API
> @node tools/ops/dev-status.mjs

dev-mode-check: ## проверить контракт режимов разработки и арбитра сборки
> node --test tools/ops/dev-mode.test.mjs

# ⚠️ ЗАПУСКАЕТСЯ РУКАМИ И РЕДКО. Переносчик читает файл ЧУЖОГО проекта
# с чужой машины: путь у каждого свой, и вшивать его сюда нельзя.
# Значения после переноса живут у нас числами в `frontend/src/themes.css`,
# поэтому сборке он не нужен вовсе.
themes: ## перенести темы из audit_project (PATH=... путь к их site-theme.tokens.css)
> node tools/dev/import-themes.mjs "$(PATH_TO_THEMES)" > frontend/src/themes.css
> @echo "перенесено; проверь: make contrast"

demo: ## завести демо-канал с диалогом (дев-данные, стираются make reset)
> $(COMPOSE) exec -T postgres psql -U $${POSTGRES_USER:-amplifie} -d $${POSTGRES_DB:-amplifie} -v ON_ERROR_STOP=1 -f - < tools/dev/demo.sql

scale-check: ## проверить нагрузочный набор панели в указанном dev-пространстве
> @test -n "$$SEED_WORKSPACE_ID" || (echo "нужен SEED_WORKSPACE_ID" && exit 2)
> $(COMPOSE) exec -T postgres psql -U $${POSTGRES_USER:-amplifie} -d $${POSTGRES_DB:-amplifie} -v workspace_id="$$SEED_WORKSPACE_ID" -f - < tools/dev/scale-panel-check.sql

scale-seed: ## добавить идемпотентный набор нагрузки панели в dev-пространство
> @test -n "$$SEED_WORKSPACE_ID" || (echo "нужен SEED_WORKSPACE_ID" && exit 2)
> $(COMPOSE) exec -T postgres psql -U $${POSTGRES_USER:-amplifie} -d $${POSTGRES_DB:-amplifie} -v workspace_id="$$SEED_WORKSPACE_ID" -f - < tools/dev/scale-panel.sql
> @$(MAKE) scale-check SEED_WORKSPACE_ID="$$SEED_WORKSPACE_ID"

psql: ## консоль базы
> $(COMPOSE) exec postgres psql -U $${POSTGRES_USER:-amplifie} -d $${POSTGRES_DB:-amplifie}

install: ## поставить зависимости локально (для типов и линтера)
> npm install

# ⚠️ ЗАМОК ВЕРСИЙ СОБИРАЕТСЯ В LINUX, А НЕ НА МАШИНЕ ЧЕЛОВЕКА.
#
# У npm известная ошибка (npm/cli#8320, воспроизводится на 10.9, 11.4 и 11.13):
# платформенные необязательные зависимости попадают в замок ТОЛЬКО для той
# платформы, где он собран. Замок, пересобранный на Windows, не содержит
# линуксовых двоичных файлов — и образ падает на `Cannot find module
# '../rolldown-binding.linux-x64-gnu.node'`. Починки от сопровождающих нет;
# названный ими путь один: собирать замок там, где потом ставят.
#
# Ставят его в двух местах, и оба линуксовые: образы (`npm ci` в Dockerfile)
# и конвейер (`npm ci` на ubuntu). На машине человека идёт `npm install`
# — он прощает отсутствие своей платформы и дописывает её сам.
#
# ⚠️ НЕ `rm package-lock.json && npm install` НА WINDOWS. Это ровно то
# действие, которое ломает сборку: 26.09 оно стоило трёх прогонов подряд.
deps-lock: ## пересобрать package-lock.json в Linux — npm/cli#8320
> MSYS_NO_PATHCONV=1 docker run --rm -v "$(CURDIR):/work" -w /work >   $(NODE_IMAGE) npm install --package-lock-only
> @echo "замок пересобран в Linux; проверь линуксовые двоичные: make deps-check"

deps-check: ## есть ли в замке двоичные файлы для Linux
> @node tools/checks/check-lock-platforms.mjs

# ⚠️ ТЕМ ЖЕ СПОСОБОМ, ЧТО У КЛИЕНТА, А НЕ СВОИМ (Р-030 ③).
#
# Было: `npx drizzle-kit migrate` с хоста. Три беды разом. Инструмент —
# оснастка разработки, в рантайм-образе его нет вовсе, значит у клиента
# этот путь не работал в принципе. Адрес собирался руками из `.env`, и это
# уже стоило нам разбора: порт в умолчаниях разошёлся с настоящим, команда
# молча ходила не туда и падала невнятным «applying migrations...». И самое
# главное — способов накатить было ДВА, наш и клиентский, а проверялся
# только наш.
#
# Теперь способ один: тот же одноразовый сервис, что поднимается у клиента.
# Замок, отчёт и коды возврата — те же самые.
migrate: ## накатить миграции — тем же способом, что у клиента
> $(COMPOSE) run --rm migrate

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

docs: ## локальные ссылки документации ведут на файлы и разделы
> node tools/checks/check-docs.mjs

decisions-check: ## гейт решений читает единый реестр и ловит отсутствие источников
> node --test tools/checks/decisions.test.mjs

proof: ## критерии успеха в планах названы числами, а не словами
> node tools/checks/check-proof.mjs

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

favicon: ## знак на вкладке не разошёлся со знаком в интерфейсе
> npm run favicon

# ⚠️ ДВА ВХОДА У ОДНОГО ПРАВИЛА. Хук `commit-msg` не даёт сделать коммит;
# эта цель смотрит на ПОСЛЕДНИЙ коммит и потому переживает обход хука
# ключом и чужой клон, где хуки никто не включал.
#
# ⚠️ Сам ключ обхода здесь не написан: `gate-not-weakened` ищет его
# в Makefile и был прав, покраснев на прежней редакции этой строки.
map: ## карта проекта обновлена вместе с коммитом
> npm run map

map-check: ## проверки самого правила карты (подсаженное нарушение)
> npm run map:check

# ⚠️ ВСЯ ИСТОРИЯ ПРАВИЛА, А НЕ ПОСЛЕДНИЙ КОММИТ (task-116). Конвейер рабочую
# ветку не видит, а последний коммит легко оказывается коммитом документов
# после кода, сделанного мимо хука.
cycle: ## план, тест, спека и ревью названы в каждом коммите продукта с появления правила
> npm run cycle

cycle-check: ## проверки самого правила цикла (подсадки, в том числе коммиты Р-044 и Р-045)
> npm run cycle:check

# ⚠️ ЧИТАЕТ ДЕРЕВО, А НЕ ЗОВЁТ CLI. Инструмент стоит глобально, а в конвейере
# его нет: гейт, зависящий от чужой глобальной установки, краснеет там,
# где код исправен.
openspec: ## спецификация поведения не расходится со сделанным (Р-027)
> npm run openspec

model: ## спросить подключённую модель вживую (не гейт, а проверка связи)
> npm run model

duplicates: ## повторы в прод-коде под храповиком
> npm run duplicates

# ⚠️ СВЕРКА ИДЁТ ПО ЗАПИСИ СЕССИИ АГЕНТА, И ЭТО НЕ ГЕЙТ (task-109). Запись
# живёт на машине, где работал агент, в конвейере её нет — поэтому в `make
# check` идёт только проверка самих правил (`trace-check`), а сверку плана
# запускают руками перед тем, как отдать план владельцу.
trace-audit: ## план заявил «прочитано целиком» — так ли было по записи сессии (PLAN=task-108)
> @test -n "$(PLAN)" || (echo "нужен PLAN, например: make trace-audit PLAN=task-108" && exit 2)
> PLAN=$(PLAN) node tools/agent/trace-audit.mjs

trace-check: ## проверки правил сверки по записи сессии и хука чтения (подсаженные нарушения)
> node --test tools/agent/trace-rules.test.mjs tools/agent/read-guard-rules.test.mjs tools/agent/session-log.test.mjs

plan-review: ## план с task-109 не одобрен без «Прочитано», «Варианты» и «Разбор критика»
> node --test tools/checks/plan-review-rule.test.mjs
> node tools/checks/check-plan-review.mjs

# ⚠️ ВСЕ ОБЪЯВЛЕННЫЕ ПРОВЕРКИ — ОДНИМ ПРОГОНОМ AQK, ПО СПИСКУ ИЗ .aqk.yml.
# Прежде тут стояла своя обёртка (tools/checks/run-gates.mjs), а `make check`
# перечислял проверки вторым списком — и списки разошлись: `rhythm` был
# в `make check`, но не в манифесте, и конвейер его не гонял. AQK 0.12 сам
# запускает гейты под Windows через Git Bash (task-029), и своя обёртка стала
# вторым способом сделать то же самое.
#
# `AQK_PROBE=0` — быстрая проверка остаётся быстрой: подсадку дефектов
# (минуты) AQK запускает раз в сто коммитов, это делает конвейер.
gates: ## все проверки из .aqk.yml одним прогоном AQK (без стенда)
> AQK_PROBE=0 npx --yes agent-quality-kit@0.18.0 doctor --run

arbiter-check: ## проверки самого счётчика согласия (числа посчитаны руками)
> npm run arbiter:check

arbiter: ## отчёт арбитра К2 — согласие людей и число агента
> npm run arbiter

label: ## выпустить лист второй разметки К2 (правится в редакторе)
> npm run label

aqk: ## ступень соответствия AQK и что до следующей
> npx --yes agent-quality-kit@0.18.0 doctor

aqk-baseline: ## обязательный минимум проекта по AQK (диагностика)
> npx --yes agent-quality-kit@0.18.0 doctor --baseline

aqk-vitals: ## подключённость инструментов, хуков и свежесть AQK
> npx --yes agent-quality-kit@0.18.0 vitals

aqk-context: ## компактное состояние репозитория для агента
> npx --yes agent-quality-kit@0.18.0 context

aqk-report: ## отчёт AQK о последнем диагностическом прогоне
> npx --yes agent-quality-kit@0.18.0 report

aqk-prompt: ## готовое задание агенту по актуальным находкам AQK
> npx --yes agent-quality-kit@0.18.0 prompt

aqk-learn: ## кандидаты в правила из локальной истории (ничего не пишет)
> npx --yes agent-quality-kit@0.18.0 learn

aqk-prove: ## доказать гейты красными и зелёными образцами
> npx --yes agent-quality-kit@0.18.0 prove

aqk-probe: ## найти классы брака, которые не ловят текущие гейты
> npx --yes agent-quality-kit@0.18.0 probe

aqk-why: ## объяснить одну рекомендацию AQK (AQK_RULE=<имя>)
> @test -n "$(AQK_RULE)" || (echo "нужен AQK_RULE, например: make aqk-why AQK_RULE=ci-not-hijackable" && exit 2)
> npx --yes agent-quality-kit@0.18.0 why "$(AQK_RULE)"

test: ## приёмочные тесты по ЖИВОМУ стеку (сначала: make up)
> npm test

openapi: ## пересобрать описание API из схем дверей (task-120)
> npm run openapi

# Арбитр описания API (task-120, Р-049): Schemathesis из Docker бьёт каждую
# дверь стенда и сверяет ответы с backend/openapi.json. ВНЕ `make check`:
# нужен стенд и минуты. Лишние флаги — ARGS, например: make api-fuzz ARGS="-n 50"
api-fuzz: ## арбитр описания API по живому стенду (сначала: make up)
> bash tools/ops/api-fuzz.sh $(ARGS)

# ⚠️ ЗАПУСКАЕТСЯ РУКАМИ И РЕДКО, И В `make check` ЕМУ НЕЛЬЗЯ. Это минуты
# и сотни соединений; быстрые проверки обязаны оставаться быстрыми, иначе
# их перестают гонять. Числа отсюда идут в реестр долга руками — вместе
# с оговоркой, на чём мерили.
#
# Настройки — переменными: TABS=50 RATE=5 SECONDS=10 make load
# (латиницей: кириллицу в имени переменной оболочка не принимает)
# ⚠️ ВНЕ `make check`, КАК И ПРИЁМОЧНЫЕ: гейту нужна живая база, он сеет
# в неё пятьдесят тысяч реплик и откатывает. Быстрым проверкам нельзя
# требовать поднятого стека — иначе их перестают гонять.
cost: ## цена горячего запроса: панель не читает лишнего (сначала: make up)
> npm run cost

load: ## нагрузочный замер по живому стеку (сначала: make up)
> node tools/load/measure.mjs

# Второй, независимый измеритель — k6 в Docker, в сети стенда через Caddy (Р-051).
# Образ — по отпечатку: чужой сборки «на лету» здесь нет. Порог нарушен — код не ноль.
# Настройки: RATE=10 DURATION=30s PEOPLE=10 P99_MS=1500 make k6
K6_IMAGE := grafana/k6:2.3.0@sha256:9c2dee7f8ed74d317e4027c06a10f169b625638189de8d4555d0b3486a5aeb34
.PHONY: k6
k6: ## двери чтения под нагрузкой, пороги краснеют — k6 (сначала: make up)
> MSYS_NO_PATHCONV=1 docker run --rm --network amplifie_default \
>   -v "$(CURDIR)/tools/load/k6:/scripts:ro" \
>   -e RATE=$${RATE:-10} -e DURATION=$${DURATION:-30s} -e PEOPLE=$${PEOPLE:-10} \
>   -e P99_MS=$${P99_MS:-1500} \
>   $(K6_IMAGE) run --quiet /scripts/reads.js

# Доставка до чужой вкладки: свой образ k6 с расширением потока (tools/load/k6/Dockerfile).
# Настройки: TABS=20 RATE=5 SEND_S=20 make k6-sse (не SECONDS: это встроенная переменная оболочки)
.PHONY: k6-sse
k6-sse: ## доставка до чужой вкладки и её время — k6 с потоком (сначала: make up)
> docker build -q -t amplifie-k6-sse tools/load/k6 >/dev/null
> MSYS_NO_PATHCONV=1 docker run --rm --network amplifie_default \
>   -v "$(CURDIR)/tools/load/k6:/scripts:ro" \
>   -e TABS=$${TABS:-20} -e RATE=$${RATE:-5} -e SEND_S=$${SEND_S:-20} \
>   amplifie-k6-sse run --quiet /scripts/delivery.js

# Сверка своего прибора и k6 на одних условиях: сеть стенда, Caddy, вкладки слушают.
# Тяжелее прочих: перед ним make conditions. Настройки: TABS=100 RATE=10 SEND_S=200
.PHONY: k6-compare
k6-compare: ## сверка двух измерителей нагрузки — расхождение красное (сначала: make up)
> docker build -q -t amplifie-k6-sse tools/load/k6 >/dev/null
> node tools/load/compare.mjs

.PHONY: db-per-event
db-per-event: ## цена одного события в транзакциях базы (сначала: make up)
> node tools/load/db-per-event.mjs

.PHONY: event-cost
event-cost: ## гейт: цена события не растёт с числом вкладок (сначала: make up)
> node tools/checks/check-event-cost.mjs

# Настройки: SLOW=1 SENDERS=3 EACH=25 SIZE=8000 make slow-client
# Настройки: SAMPLES=5 make conditions
.PHONY: conditions
conditions: ## условия замера числами: тихо ли на стенде (сначала: make up)
> node tools/load/conditions.mjs

# Настройки: TABS=3000 DOWN_S=10 MESSAGES=20 make load-outage
# ⚠️ Останавливает настоящий api стенда на DOWN_S секунд (task-093).
.PHONY: load-outage
load-outage: ## выкладка посреди прогона: возвращаются ли все вкладки (сначала: make up)
> MSYS_NO_PATHCONV=1 docker run --rm --network amplifie_default -v "$(CURDIR):/work" -w /work >   -v /var/run/docker.sock:/var/run/docker.sock -e AMPLIFIE_BASE_URL=http://api:3000 >   -e TABS=$${TABS:-500} -e DOWN_S=$${DOWN_S:-10} -e MESSAGES=$${MESSAGES:-20} >   node:24-bookworm-slim node tools/load/outage.mjs

.PHONY: slow-client
slow-client: ## что медленный клиент делает с памятью, Д-14 (сначала: make up)
> node tools/load/slow-client.mjs

# Настройки: TABS=40 MESSAGES=10 GAP_MS=300 make panel-cost
.PHONY: panel-cost
panel-cost: ## цена потока сообщений: что стоит панель на реплику (сначала: make up)
> node tools/load/panel-cost.mjs

# Настройки: SENDERS=50 EACH=5 SPREAD=same|spaces make write-ceiling
.PHONY: write-ceiling
write-ceiling: ## потолок записи в одно пространство, Д-2 (сначала: make up)
> node tools/load/write-ceiling.mjs

# ⚠️ ОТДЕЛЬНАЯ БАЗА `amplifie_search`, А НЕ СТЕНД (task-100). Миллионы реплик
# в рабочей базе сломали бы стенд и все прочие замеры. Засев возобновляется
# с места остановки; удалить базу — решение владельца.
# Объём: MESSAGES=1000000 make search-seed
.PHONY: search-seed search-measure
search-seed: ## засеять отдельную базу для замера поиска (сначала: make up)
> npx tsc --build backend && node tools/load/search-seed.mjs

search-measure: ## замер поиска и цены триггера на засеянной базе (после: make search-seed)
> node tools/load/search-measure.mjs

# Второй сервер и прокси на базе засева, порт 8479; стенд не трогается.
.PHONY: search-demo search-demo-stop
search-demo: ## потыкать поиск руками на засеве (сначала: make up и make search-seed)
> npx tsc --build backend && node tools/load/search-demo.mjs

search-demo-stop: ## остановить показ поиска на засеве
> node tools/load/search-demo.mjs --stop

# ⚠️ УСТАНОВКА БРАУЗЕРА СТОИТ ЗДЕСЬ, А НЕ В ЧЬЕЙ-ТО ПАМЯТИ. Самая частая
# поломка Playwright у других — версия пакета уехала, браузеры остались
# старые, и прогон падает «нет браузера» на исправном коде. Команда
# доводит браузер до версии пакета сама; уже стоящий не перекачивается.
#
# ⚠️ ВНЕ `make check`. Быстрым проверкам нельзя требовать поднятого стека
# и браузера — иначе их перестают гонять. Тот же довод, что у `make test`.
# Ревью набора правок open-code-review в режиме делегирования (Р-046):
# ocr выбирает файлы и правила, само ревью делает агент по своей подписке.
# Без ARGS — рабочая копия; ARGS="--commit <hash>" или "--from main --to HEAD".
review: ## файлы и правила ревью для набора правок (open-code-review, Р-046)
> @command -v ocr >/dev/null 2>&1 || { echo "нет ocr: npm i -g @alibaba-group/open-code-review"; exit 1; }
> ocr delegate preview $(ARGS)

test-ui: env ## проверки интерфейса настоящим браузером и свежим образом
# ⚠️ ПОДНИМАЕМ CADDY ОБРАТНО, И ЭТО НЕ ПЕРЕСТРАХОВКА. Проверки обязаны
# бить по СОБРАННОМУ образу (Р-022): по нему уедет к людям, и только он
# ловит поломки сборки. Забыл после `make work` — и проверки молча
# прошли бы по дев-сборке, то есть арбитр соврал бы, а это худший
# вид отказа (см. инцидент с заглушкой в Caddyfile).
> @$(COMPOSE) up -d --build || (echo ""; echo "не удалось поднять свежий Caddy-стенд: если :8477 занят Vite, погаси make work (Ctrl+C) и повтори."; exit 1)
> npx playwright install chromium
> npm run test-ui

# ⚠️ ВНЕ `make check`, И ПО ТОЙ ЖЕ ПРИЧИНЕ, ЧТО `test` И `test-ui`: это
# сборка образов, выгрузка их архивом и подъём отдельной установки — минуты.
# Быстрые проверки обязаны оставаться быстрыми, иначе их перестают гонять.
#
# ⚠️ УДАЛЯЕТ ЛОКАЛЬНЫЕ ОБРАЗЫ И ВОЗВРАЩАЕТ ИХ ИЗ АРХИВА. Работающий стенд
# при этом не трогается: у проверки свой порт, своё имя проекта и свои тома.
delivery: ## пройти путь клиента: архив образов → голый up → живая установка
> bash tools/ops/check-delivery.sh $${DELIVERY_PORT:-8479}

check: gates ## всё быстрое разом — то же, что гоняет CI (список — .aqk.yml)
> @echo "все быстрые проверки прошли"

.PHONY: openapi api-fuzz caddy-volume trace-audit trace-check plan-review help env env-box env-check delivery hooks wait-api up dev-deps work dev dev-api down reset logs ps health dev-status dev-mode-check demo themes psql install migrate migrate-new typecheck lint format arch docs decisions decisions-check contrast rhythm unit no-raw-html failure-map favicon map map-check cycle cycle-check openspec duplicates gates arbiter-check model arbiter label aqk aqk-baseline aqk-vitals aqk-context aqk-report aqk-prompt aqk-learn aqk-prove aqk-probe aqk-why test test-ui load load-outage conditions check
