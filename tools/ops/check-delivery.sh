#!/usr/bin/env bash
# Арбитр поставки: проходим ПУТЬ КЛИЕНТА и смотрим, что получилось (Р-030 ⑩).
#
# ⚠️ ЗАЧЕМ ОТДЕЛЬНЫМ СКРИПТОМ, А НЕ ШАГАМИ В CI. Арбитр, живущий только
# в конвейере, проверяется только конвейером: чтобы его испытать, надо
# запушить и ждать. Здесь он запускается руками за минуты, а конвейер зовёт
# ровно эту же программу — одно определение, а не два расходящихся.
#
# ⚠️ ЧТО ИМЕННО ОН СНИМАЕТ. Три самообмана, каждый из которых давал бы
# зелёный свет на сломанной поставке:
#
#   ① явный `-f compose.yml` проверял бы НАШЕ поведение, а не клиентское.
#      Клиент набирает голое `docker compose up`, и именно оно обязано
#      означать коробку. При явном `-f` подсадка «дев-файл назван override»
#      не сработала бы вовсе — подхватываться нечему;
#   ② «чистая машина», у которой откуда-то есть образы. Сборка лежит в кеше
#      того же демона, и `up` взял бы её молча: проверялась бы сборка,
#      а не поставка. Поэтому образы выгружаются архивом и удаляются;
#   ③ архив, в котором нет Postgres. Мы его не собираем, и без запрета
#      на скачивание он молча приехал бы из сети — а клиент в закрытом
#      контуре узнал бы об этом первым. Поэтому `--pull never`.
#
# Запуск: bash tools/ops/check-delivery.sh [порт]
set -euo pipefail

PORT="${1:-8479}"
PROJECT="amplifie_postavka"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d)"
ARCHIVE="$WORK/amplifie-release.tar"
SHIPDIR="$WORK/postavka"

step() { printf '\n\033[36m▸ %s\033[0m\n' "$1"; }
fail() { printf '\033[31m✖ %s\033[0m\n' "$1" >&2; exit 1; }
ok_() { printf '\033[32m✔ %s\033[0m\n' "$1"; }

cleanup() {
  docker compose -p "$PROJECT" --project-directory "$SHIPDIR" down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

cd "$ROOT"

# ⚠️ ВЕРСИЯ — В ИМЕНИ ОБРАЗА И В compose.yml ПОСТАВКИ, А НЕ В .env КЛИЕНТА
# (task-118). `.env` не перезаписывается никогда, а обновление — это новый
# compose.yml и `up`: версия в `.env` молча держала бы старые образы.
VERSION="$(git describe --tags --always --dirty 2>/dev/null || echo dev)"
export AMPLIFIE_VERSION="$VERSION"
export AMPLIFIE_IMAGE_API="amplifie/api:$VERSION"
export AMPLIFIE_IMAGE_WEB="amplifie/web:$VERSION"

step "Без названного образа базовый файл не поднимается — никакого latest"
BARE="$(mktemp -d)"
cp compose.yml "$BARE/"
if (cd "$BARE" && env -u AMPLIFIE_IMAGE_API -u AMPLIFIE_IMAGE_WEB docker compose config >/dev/null 2>"$BARE/err"); then
  fail "compose.yml поднялся без названного образа — у клиента взялся бы любой с диска"
fi
grep -q "не назван образ" "$BARE/err" || fail "отказ без объяснения: $(cat "$BARE/err")"
rm -rf "$BARE"
ok_ "без названного образа — отказ с объяснением"

step "Собираем образы $VERSION"
docker compose -f compose.yml -f compose.dev.yml build >/dev/null

# ⚠️ СПИСОК БЕРЁТСЯ ИЗ РАЗОБРАННОГО БАЗОВОГО ФАЙЛА, А НЕ ПИШЕТСЯ РУКАМИ.
# «Образы» здесь значит ВСЕ рантаймовые образы установки, включая postgres.
# Список руками разошёлся бы с файлом на первой же правке — и разошёлся бы
# молча, потому что проверка осталась бы зелёной.
IMAGES="$(docker compose -f compose.yml config --images | sort -u)"
step "В поставку входят образы:"
printf '   %s\n' $IMAGES

# Чужие образы (Postgres) сборка не приносит. На стенде они лежат с прошлого
# подъёма, на чистой машине CI их нет — и `docker save` падал «reference
# does not exist» на первом же прогоне конвейера. Скачивается только
# недостающее: наши образы только что собраны, в реестре их нет.
for image in $IMAGES; do
  docker image inspect "$image" >/dev/null 2>&1 || docker pull --quiet "$image" >/dev/null
done

step "Выгружаем архивом и удаляем локальные"
docker save $IMAGES -o "$ARCHIVE"
# ⚠️ ПО ИМЕНАМ, А НЕ ОБЩЕЙ ЧИСТКОЙ. `prune` снёс бы кеш соседних работ
# конвейера и сделал бы гейт дорогим и капризным на ровном месте.
docker rmi -f $IMAGES >/dev/null
for image in $IMAGES; do
  docker image inspect "$image" >/dev/null 2>&1 && fail "образ $image не удалился — проверка ничего не докажет"
done
ok_ "локальных образов не осталось: взять их можно только из архива"

step "Собираем каталог поставки"
# Ровно то, что получает клиент. Ничего больше: ни исходников, ни дев-файла.
mkdir -p "$SHIPDIR"
# Имена образов — строкой в compose.yml поставки; в .env только секреты.
sed -e "s#\${AMPLIFIE_IMAGE_API:?[^}]*}#$AMPLIFIE_IMAGE_API#" \
  -e "s#\${AMPLIFIE_IMAGE_WEB:?[^}]*}#$AMPLIFIE_IMAGE_WEB#" compose.yml >"$SHIPDIR/compose.yml"
if grep -q "AMPLIFIE_IMAGE" "$SHIPDIR/compose.yml"; then
  fail "в compose.yml поставки осталась переменная образа"
fi
( cd "$SHIPDIR" && node "$ROOT/tools/ops/make-env.mjs" box "$PORT" >/dev/null )
printf '   в каталоге: %s\n' "$(ls -A "$SHIPDIR" | tr '\n' ' ')"

step "Загружаем образы из архива и поднимаем ГОЛЫМ up"
docker load -i "$ARCHIVE" >/dev/null
(
  cd "$SHIPDIR"
  # Голое `docker compose up` — то самое, что наберёт клиент. Никаких `-f`.
  # И без переменных окружения make: установка обязана подняться ТОЛЬКО
  # своими файлами — иначе зелёный был бы по чужой причине.
  env -u AMPLIFIE_IMAGE_API -u AMPLIFIE_IMAGE_WEB -u AMPLIFIE_VERSION \
    docker compose -p "$PROJECT" up -d --pull never
)

step "Ждём здоровья"
for _ in $(seq 1 45); do
  if curl -fsS "http://localhost:$PORT/health" >/dev/null 2>&1; then break; fi
  sleep 2
done
HEALTH="$(curl -fsS "http://localhost:$PORT/health" || fail "установка не поднялась за 90 секунд")"
printf '   %s\n' "$HEALTH"

echo "$HEALTH" | grep -q '"status":"ok"' || fail "здоровье не «ok»"
ok_ "установка поднялась из архива, без единого обращения в сеть за образом"

echo "$HEALTH" | grep -q '"migrations":[1-9]' || fail "миграции не накатились сами"
ok_ "миграции накатались сами — одноразовым сервисом"

echo "$HEALTH" | grep -q '"version":"' || fail "установка не называет свою версию"
ok_ "установка называет версию — поддержке есть что спросить"

# ⚠️ ЭТА ПРОВЕРКА ЧИТАЕТ НАСТРОЙКУ, А НЕ ПОВЕДЕНИЕ, И ТАК И ЗАДУМАНО.
# Подсадка «бек не ждёт успешного кода миграции» прошла живой прогон
# НЕЗАМЕЧЕННОЙ: база локальная и быстрая, миграция успевала закончиться
# раньше первой проверки здоровья, и всё выглядело исправным. Гонку нельзя
# поймать наблюдением — её выигрывают или проигрывают случайно, и арбитр,
# зависящий от везения, врёт ровно тогда, когда нужен.
#
# Поэтому здесь утверждается САМА СВЯЗЬ: бек не стартует, пока миграции
# не накатились с нулевым кодом. Это детерминированно и краснеет всегда.
step "Бек обязан ждать успешного кода миграции"
docker compose -f compose.yml config | grep -q "service_completed_successfully"   || fail "бек не ждёт успешного кода миграции — половина схемы пройдёт как исправная установка"
ok_ "связь на месте: половина схемы не притворится рабочей установкой"

step "Смотрим, что торчит наружу"
# ⚠️ ЧЕРЕЗ `docker inspect`, А НЕ ЧЕРЕЗ `ps --format Publishers`. У второго
# вид меняется от версии Compose, и первая же попытка молча оборвала скрипт
# на пустом `grep` под `set -e` — арбитр умер, ничего не сказав, а это худший
# из возможных исходов для арбитра. У `inspect` вид стабилен и описан.
CONTAINERS="$(docker compose -p "$PROJECT" --project-directory "$SHIPDIR" ps -aq)"
EXPOSED="$(for c in $CONTAINERS; do
  docker inspect "$c" --format '{{range $p, $conf := .NetworkSettings.Ports}}{{range $conf}}{{.HostPort}} {{end}}{{end}}'
done | tr ' ' '
' | grep -E '^[0-9]+$' | sort -u || true)"
printf '   опубликовано наружу: %s
' "$(echo $EXPOSED)"
[ -n "$EXPOSED" ] || fail "наружу не опубликовано ничего — установка недостижима"
[ "$(echo "$EXPOSED" | wc -w)" -eq 1 ] || fail "наружу торчит больше одного порта: $(echo $EXPOSED)"
[ "$EXPOSED" = "$PORT" ] || fail "наружу торчит не тот порт: $EXPOSED вместо $PORT"
ok_ "наружу опубликован ровно один порт — и это порт установки"

# ⚠️ САМАЯ ВАЖНАЯ ПРОВЕРКА ФАЙЛА, И ГЛАЗАМИ ЕЁ НЕ СДЕЛАТЬ.
# Коробка — одна установка, одна компания (Р-024). Если в базовый файл
# просочится `AMPLIFIE_MULTI_WORKSPACE`, регистрация останется открытой,
# и любой, знающий адрес, заведёт на чужом сервере свою компанию. Снаружи
# это выглядит совершенно нормально — до того дня, когда не выглядит.
step "Проверяем, что регистрация закрывается после первого человека"
# ⚠️ ТЕЛО ЗАПРОСА ЦЕЛИКОМ ЛАТИНИЦЕЙ, И ЭТО НЕ НЕБРЕЖНОСТЬ. Кириллица в нём
# ломает длину: оболочка на Windows отдаёт байты в своей кодировке, curl
# считает Content-Length по другой, и сервер отвечает 400 «размер тела
# не совпал с заявленным» — то есть арбитр краснел бы на исправном продукте.
# Проверяем мы здесь поставку, а не поддержку русского: её проверяют
# приёмочные, которые ходят через настоящий клиент.
EMAIL="ustanovka-$$@example.test"
curl -fsS -X POST "http://localhost:$PORT/v1/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"parol-dlya-proverki-postavki\",\"displayName\":\"Owner\",\"workspaceName\":\"Company\"}" \
  >/dev/null || fail "первый человек не смог зарегистрироваться"
ok_ "первый человек завёл компанию"

SECOND="$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://localhost:$PORT/v1/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"vtoroy-$$@example.test\",\"password\":\"parol-dlya-proverki-postavki\",\"displayName\":\"Second\",\"workspaceName\":\"Other\"}")"
[ "$SECOND" = "403" ] || fail "второй завёл СВОЮ компанию на чужом сервере (ответ $SECOND, ждали 403)"
ok_ "второму отказано — коробка осталась коробкой"

printf '\n\033[32m════ путь клиента пройден целиком ════\033[0m\n'

# ⚠️ В ВЫПУСК ИДЁТ ЭТОТ САМЫЙ АРХИВ, А НЕ СОБРАННЫЙ ЗАНОВО (task-066). Второй
# сборкой проверено было бы одно, а уехало другое. Сюда доходит только
# прошедший путь клиента: любой отказ выше уже вышел из скрипта.
if [ -n "${RELEASE_DIR:-}" ]; then
  step "Складываем выпуск в $RELEASE_DIR"
  mkdir -p "$RELEASE_DIR"
  gzip -c "$ARCHIVE" > "$RELEASE_DIR/amplifie-$VERSION-images.tar.gz"
  cp "$SHIPDIR/compose.yml" tools/ops/make-env.mjs "$RELEASE_DIR/"
  ( cd "$RELEASE_DIR" && sha256sum -- * > SHA256SUMS )
  ok_ "выпуск: $(ls "$RELEASE_DIR" | tr '\n' ' ')"
fi
