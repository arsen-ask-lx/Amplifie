#!/usr/bin/env bash
# Арбитр описания API (task-120, Р-049): Schemathesis бьёт каждую дверь живого
# стенда странными данными и сверяет ответы с backend/openapi.json.
#
# ⚠️ ВСЕ ПРОВЕРКИ — умолчание Schemathesis (все включены), и каждое ослабление
# названо ниже с причиной. `-c not_a_server_error` зелёный на сервере, который
# врёт в каждом поле (замер AQK), — сужать проверки молча нельзя. Файл настроек
# пишется этим же скриптом, в репозитории его нет: всё, что ослаблено, — здесь.
# Флаг `--checks all` НЕ ставим: он перекрывает настройку одной двери из файла
# (проверено прогоном 27.09), а все проверки включены и без него.
#
# Требует поднятого стенда (make up). Каждый прогон — новый человек в новом
# пространстве: прогон не зависит от прошлого и не портит чужие данные.
set -euo pipefail

BASE="${API_FUZZ_URL:-http://localhost:8477}"
# Из контейнера стенд виден по имени хоста; на Linux имя даёт --add-host ниже.
INNER="${API_FUZZ_INNER_URL:-http://host.docker.internal:8477}"
IMAGE="schemathesis/schemathesis@sha256:0a71757c60ccdba270c154a859d9dd3d019625f782f23ab36ad604771e15f78b" # 4.28.0

if ! curl -fsS "$BASE/health" >/dev/null; then
  echo "стенд не отвечает на $BASE/health — подними: make up" >&2
  exit 2
fi

# Сессия прогона — печенька нового человека. Значение не печатается.
# Имена латиницей: Git Bash на Windows портил кириллицу в теле curl (400).
EMAIL="fuzz-$(date +%s)-$RANDOM@amplifie.test"
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT
STATUS=$(curl -sS -o /dev/null -w '%{http_code}' -c "$JAR" -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"fuzz-password-123\",\"displayName\":\"Fuzzer\",\"workspaceName\":\"API fuzz\"}" \
  "$BASE/v1/auth/register")
if [ "$STATUS" != 201 ]; then
  echo "не удалось завести человека прогона: регистрация ответила $STATUS" >&2
  exit 2
fi
SESSION=$(awk '$6 == "amplifie_session" { print $7 }' "$JAR")
[ -n "$SESSION" ] || { echo "регистрация не выдала печеньку сессии" >&2; exit 2; }

# Машина моста прогона: код подключения от человека → удостоверение машины.
# Двери машины (`/v1/bridge/…`) идут в прогон под своей схемой `bridge`.
json_field() { node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{process.stdout.write(String(JSON.parse(d)[process.argv[1]]??""))}catch{}})' "$1"; }
CODE=$(curl -sS -b "$JAR" -X POST -H 'content-type: application/json' -d '{}' "$BASE/v1/bridges" | json_field code)
[ -n "$CODE" ] || { echo "не удалось выдать код моста прогона" >&2; exit 2; }
BRIDGE=$(curl -sS -X POST -H 'content-type: application/json' \
  -d "{\"code\":\"$CODE\",\"name\":\"fuzz\"}" "$BASE/v1/bridge/join" | json_field token)
[ -n "$BRIDGE" ] || { echo "машина моста прогона не подключилась" >&2; exit 2; }

# Исключены — с причиной и с арбитром, который держит дверь вместо фаззера:
#   /v1/auth/logout    гасит печеньку прогона, дальше всё 401 — auth.e2e;
#   /v1/stream         SSE, соединение не кончается — приёмочные живых обновлений;
#   /v1/bridge/next    держит запрос до 25 с (длинный опрос): сотня примеров — час
#                      ожидания; работу и 204 проверяет bridge.e2e;
#   /v1/model/check    без живой модели за мостом честно отвечает только 503 —
#                      ответ модели проверяет bridge.e2e;
#   /metrics           внутренняя дверь: Caddy её наружу не публикует, на её адресе
#                      снаружи — страница приложения.
#
# ОСЛАБЛЕНО — с причиной; это ограничения стандарта, а не долг:
#   positive_data_acceptance у GET /v1/conversations/{id}/messages: «before или
#       after, не оба» — зависимость двух параметров, OpenAPI её выразить не может
#       (Martin-Lopez et al., «A Catalogue of Inter-Parameter Dependencies in
#       RESTful Web APIs», ICSOC 2019);
#       так же устроены starting_after/ending_before у Stripe;
#   ensure_resource_availability у POST /v1/conversations/{id}/messages: ответ на
#       невидимую реплику — 404, как велят JSON:API и Google AIP-193 для ссылки на
#       несуществующий ресурс; Schemathesis принимает его за пропавший чат;
#   догадки о связях — выключены: связи названы явно (`links`, links.ts), а
#       догадка вывела `/v1/projects/None/pin` из `projectId: null`.

# ⚠️ ФАЙЛ НАСТРОЕК — ДЛЯ ВХОДА И ОСЛАБЛЕНИЙ ОДНОЙ ДВЕРИ. Печенька, поданная
# заголовком, едет в КАЖДЫЙ запрос, и проверка «без входа — 401» получала
# ложные 200. Схемы безопасности из описания дают Schemathesis убрать
# удостоверение там, где он проверяет отказ. Флага для этого нет — только файл;
# ослабление на одну дверь флагом тоже не задать.
mkdir -p tmp
AUTH="tmp/api-fuzz-auth.toml"
cat > "$AUTH" <<'TOML'
[auth.openapi.session]
api_key = "${AMPLIFIE_SESSION}"

[auth.openapi.bridge]
api_key = "Bridge ${AMPLIFIE_BRIDGE}"

[phases.stateful.inference]
algorithms = []

[[operations]]
include-path = "/v1/conversations/{id}/messages"
include-method = "GET"
checks = { positive_data_acceptance.enabled = false }

[[operations]]
include-path = "/v1/conversations/{id}/messages"
include-method = "POST"
checks = { ensure_resource_availability.enabled = false }
TOML
trap 'rm -f "$JAR" "$AUTH"' EXIT

# ⚠️ Git Bash на Windows переписывает аргументы вида /путь в C:/Program Files/Git/…:
# docker получал несуществующий /spec. Отключаем подмену, а свой каталог берём
# в виде, понятном Docker Desktop (`pwd -W` даёт E:/…; на Linux его нет).
export MSYS_NO_PATHCONV=1
HERE="$(pwd -W 2>/dev/null || pwd)"
docker run --rm --add-host=host.docker.internal:host-gateway \
  -e AMPLIFIE_SESSION="$SESSION" \
  -e AMPLIFIE_BRIDGE="$BRIDGE" \
  -v "$HERE/backend/openapi.json:/spec/openapi.json:ro" \
  -v "$HERE/$AUTH:/spec/auth.toml:ro" \
  "$IMAGE" --config-file /spec/auth.toml run /spec/openapi.json \
  --url "$INNER" \
  --rate-limit "${API_FUZZ_RATE:-300/m}" \
  --exclude-path /v1/auth/logout \
  --exclude-path /v1/stream \
  --exclude-path /v1/model/check \
  --exclude-path /metrics \
  --exclude-path /v1/bridge/next \
  "$@"
