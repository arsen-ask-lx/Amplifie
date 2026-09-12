#!/usr/bin/env node
/**
 * Настройки установки РОЖДАЮТСЯ, а не копируются (Р-030 ⑤).
 *
 * ПОЧЕМУ ОДНА ПРОГРАММА НА ДВА ПРОФИЛЯ. Знание «что нужно свежей установке»
 * одно. До этой задачи оно было размазано на три места: `.env.example` знал
 * список переменных, `ensure-secret.mjs` — что мастер-ключ рождается, а
 * `compose.yml` — что настоящей установке нельзя `MULTI_WORKSPACE`. Три
 * хранителя одного знания расходятся молча, и первым это замечает клиент.
 *
 * ПОЧЕМУ КОРОБКЕ НЕЛЬЗЯ КОПИРОВАТЬ ОБРАЗЕЦ. В `.env.example` стоят слабый
 * пароль, `NODE_ENV=development` и `AMPLIFIE_MULTI_WORKSPACE=true`. Последнее —
 * дыра: любой, знающий адрес, заводит на чужом сервере свою компанию (Р-024).
 * Правильный код в `platform/config.ts` этому не помогает: он требует явного
 * слова «true», а образец это слово и приносит. Образец копируют, код читают.
 *
 * ⚠️ ЭТА ПРОГРАММА НЕ ПЕРЕЗАПИСЫВАЕТ СУЩЕСТВУЮЩИЙ .env. Перезапись означала бы
 * НОВЫЙ мастер-ключ, а с ним — потерю всех сохранённых ключей моделей: Р-016
 * говорит прямо, что восстановления нет и быть не может. Разрушительное
 * действие обязано требовать отдельного слова, а не случаться от повторного
 * запуска команды.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

/** Имя мастер-ключа. Одно на всю программу — второй копии строки не заводим. */
export const KEY_NAME = "AMPLIFIE_SECRET_KEY";

/** 32 байта в base64 — столько требует AES-256-GCM (Р-016). */
export function secret() {
  return randomBytes(32).toString("base64");
}

/**
 * Пароль базы для коробки.
 *
 * base64url, а не base64: пароль уезжает в `DATABASE_URL`, а `+` и `/`
 * в строке подключения значат другое. Тихо испорченный адрес базы —
 * это «приложение не стартует» без единой подсказки почему.
 */
export function password() {
  return randomBytes(24).toString("base64url");
}

/**
 * Настройки настоящей установки.
 *
 * ⚠️ СТРОКИ `AMPLIFIE_MULTI_WORKSPACE` здесь нет ВОВСЕ, и это не забывчивость.
 * Отсутствие настройки и `=false` читаются приложением одинаково, а человеком —
 * по-разному: увидев `=false`, его однажды переставят в `true`, чтобы
 * «проверить». Чего нет, то не переставляют.
 *
 * Порт Postgres наружу не публикуется, поэтому и переменной для него нет:
 * внутри сети база слушает 5432, и адрес собран под это.
 */
export function boxSettings({ password: pwd, key, port = 8477, database = "amplifie" }) {
  return `# Настройки установки Amplifie. Рождены \`make env-box\`.
#
# ⚠️ ЭТОТ ФАЙЛ — ЕДИНСТВЕННАЯ КОПИЯ МАСТЕР-КЛЮЧА. Потеряете его — потеряете
# все сохранённые ключи моделей: расшифровать их больше нечем (Р-016).
# Храните копию отдельно от сервера и отдельно от резервных копий базы:
# укравший и то и другое получает и замок, и ключ.

POSTGRES_USER=${database}
POSTGRES_PASSWORD=${pwd}
POSTGRES_DB=${database}
DATABASE_URL=postgres://${database}:${pwd}@postgres:5432/${database}

API_PORT=3000
LOG_LEVEL=info
NODE_ENV=production

# Что слушает установка снаружи.
HTTP_PORT=${port}

${KEY_NAME}=${key}
`;
}

/**
 * Дописать мастер-ключ в уже существующие настройки, если его там нет.
 *
 * Это прежнее поведение `ensure-secret.mjs`, слово в слово: у образца ключ
 * пуст нарочно — готовое значение в нём означало бы, что у всех установок
 * мастер-ключ один и тот же, то есть что его нет.
 *
 * Идемпотентно: заполненный ключ не трогается. Иначе второй `make env`
 * молча обесценил бы всё, что зашифровано первым.
 */
export function withKey(text, key) {
  const filled = new RegExp(`^${KEY_NAME}=.+$`, "mu");
  if (filled.test(text)) return text;

  const empty = new RegExp(`^${KEY_NAME}=\\s*$`, "mu");
  const line = `${KEY_NAME}=${key}`;
  return empty.test(text) ? text.replace(empty, line) : `${text.trimEnd()}\n${line}\n`;
}

/** Профиль стенда: образец плюс свой мастер-ключ. */
function devProfile(file, template) {
  if (!existsSync(file)) {
    if (!existsSync(template)) {
      throw new Error(`нет ни ${file}, ни ${template} — копировать не из чего`);
    }
    writeFileSync(file, readFileSync(template, "utf8"));
    console.log(`создан ${file} из ${template}`);
  }

  const before = readFileSync(file, "utf8");
  const after = withKey(before, secret());
  if (before === after) return;

  writeFileSync(file, after);
  console.log(`создан мастер-ключ шифрования в ${file}.`);
  console.log("БЕЗ НЕГО КЛЮЧИ УЧАСТНИКОВ НЕ ЧИТАЮТСЯ — не теряйте этот файл.");
}

/**
 * Профиль коробки: всё своё и ничего дев-ового.
 *
 * Порт можно назвать вторым доводом — это нужно арбитру поставки, который
 * поднимает настоящую установку рядом с уже работающим стендом.
 */
function boxProfile(file, port = 8477) {
  if (existsSync(file)) {
    throw new Error(
      `${file} уже есть — отказываюсь перезаписать.\n` +
        `  ПОЧЕМУ: перезапись выдаст НОВЫЙ мастер-ключ, и все сохранённые ключи\n` +
        `  моделей станут нечитаемыми навсегда (Р-016). Восстановления нет.\n` +
        `  ЕСЛИ ЭТО НУЖНО: уберите ${file} сами, осознанно и с копией.`,
    );
  }

  writeFileSync(file, boxSettings({ password: password(), key: secret(), port: port }));
  console.log(`создан ${file} для настоящей установки.`);
  console.log("В НЁМ ЕДИНСТВЕННАЯ КОПИЯ МАСТЕР-КЛЮЧА — сделайте копию отдельно от сервера.");
}

const PROFILES = { dev: devProfile, box: boxProfile };

// Запуск как программы, а не как модуля: тесты берут функции выше напрямую.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll("\\", "/"))) {
  const profile = process.argv[2] ?? "dev";
  const chosen = PROFILES[profile];
  if (!chosen) {
    console.error(`неизвестный профиль «${profile}»; есть: ${Object.keys(PROFILES).join(", ")}`);
    process.exit(1);
  }
  try {
    chosen(".env", profile === "box" ? Number(process.argv[3] ?? 8477) : ".env.example");
  } catch (failure) {
    console.error(failure instanceof Error ? failure.message : failure);
    process.exit(1);
  }
}
