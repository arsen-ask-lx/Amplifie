#!/usr/bin/env node
/**
 * Проверки генератора настроек (task-030, В-3).
 *
 * ПОЧЕМУ `node --test`, А НЕ `make unit`. Быстрые проверки описаны как
 * `{backend,frontend,bridge}/src/**` — это продуктовый код. Оснастка у нас
 * проверяется своим входом: так уже устроены `map:check` и `arbiter:check`.
 * Расширять список продуктовых проверок ради одного файла оснастки значило бы
 * стереть границу, которая проведена нарочно.
 *
 * ЧТО ИМЕННО ЗДЕСЬ ДОКАЗЫВАЕТСЯ. Не «программа запускается», а что рождённые
 * настоящей установке настройки НЕ СОДЕРЖАТ дев-ового. Глазами это не увидеть:
 * файл рождается программой, а не лежит в репозитории.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { boxSettings, KEY_NAME, password, secret, withKey } from "./make-env.mjs";

const box = () => boxSettings({ password: password(), key: secret() });

test("коробке не достаётся разрешение на много компаний", () => {
  // Главная проверка файла. Отсутствие строки, а не «=false»: увидев `false`,
  // его однажды переставят в `true`, чтобы «проверить».
  assert.doesNotMatch(box(), /MULTI_WORKSPACE/u);
});

test("коробка получает боевой режим и свой пароль, а не образцовый", () => {
  const text = box();
  assert.match(text, /^NODE_ENV=production$/mu);
  assert.doesNotMatch(text, /amplifie_dev_only/u);
});

test("пароль базы не ломает адрес подключения", () => {
  // base64 обычный дал бы «+» и «/», а они в строке подключения значат другое.
  // Тихо испорченный адрес — это «не стартует» без единой подсказки почему.
  for (let i = 0; i < 50; i += 1) assert.match(password(), /^[\w-]+$/u);
});

test("адрес базы собран из того же пароля, что и сама база", () => {
  // Два места, где живёт пароль, — единственный способ их рассогласовать
  // это опечатка в шаблоне. Проверяем, что её нет.
  const text = boxSettings({ password: "СЕКРЕТ", key: "КЛЮЧ" });
  assert.match(text, /^POSTGRES_PASSWORD=СЕКРЕТ$/mu);
  assert.match(text, /^DATABASE_URL=postgres:\/\/amplifie:СЕКРЕТ@postgres:5432\/amplifie$/mu);
});

test("мастер-ключ у коробки свой, а не общий", () => {
  const first = box();
  const second = box();
  assert.notEqual(first, second);
});

test("пустой ключ в образце заполняется", () => {
  const after = withKey(`A=1\n${KEY_NAME}=\nB=2\n`, "ЗНАЧЕНИЕ");
  assert.match(after, new RegExp(`^${KEY_NAME}=ЗНАЧЕНИЕ$`, "mu"));
  // Соседние строки не тронуты: замена идёт по строке, а не по файлу.
  assert.match(after, /^B=2$/mu);
});

test("уже заполненный ключ не трогается", () => {
  // Иначе второй `make env` молча обесценил бы всё, что зашифровано первым.
  const before = `${KEY_NAME}=СТАРЫЙ\n`;
  assert.equal(withKey(before, "НОВЫЙ"), before);
});

test("ключа нет вовсе — дописывается в конец", () => {
  assert.match(withKey("A=1\n", "ЗНАЧЕНИЕ"), new RegExp(`^${KEY_NAME}=ЗНАЧЕНИЕ$`, "mu"));
});
