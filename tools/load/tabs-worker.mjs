#!/usr/bin/env node
/**
 * Держатель вкладок: отдельный процесс, который только слушает потоки.
 *
 * ⚠️ ЗАЧЕМ ОТДЕЛЬНЫЙ ПРОЦЕСС, А НЕ ФУНКЦИЯ. Пока вкладки и отправка жили
 * в одном процессе Node, замер мерил СЕБЯ: четыреста потоков плюс догоны
 * забивали событийный цикл, и время ответа на отправку росло до секунд
 * при исправном сервере. Проверено числами — 400 вкладок дали 4,8 с
 * в середине даже когда вкладки не делали ни одного запроса, чего
 * на сервере быть не могло.
 *
 * Теперь роли разведены: этот процесс только слушает и догоняет, а время
 * отправки мерит родитель, которому больше ничем заниматься не нужно.
 * Один процесс на сотню вкладок — тогда ни один не становится узким местом
 * раньше сервера.
 *
 * Запускается не руками, а `measure.mjs` через `fork`.
 */

import { openTabs } from "./stand.mjs";

const seen = [];
let held = [];

process.on("message", async (message) => {
  if (message.open) {
    const { token, count, watching } = message.open;
    try {
      held = await openTabs(token, count, seen, undefined, { watching });
      process.send({ ready: held.length });
    } catch (error) {
      process.send({ failed: String(error?.message ?? error) });
    }
    return;
  }

  if (message.stop) {
    for (const controller of held) controller.abort();
    process.send({ seen: seen.length });
    process.exit(0);
  }
});
