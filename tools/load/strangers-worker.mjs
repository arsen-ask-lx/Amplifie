#!/usr/bin/env node

/**
 * Свидетель обстановки: что делали ЧУЖИЕ контейнеры во время прогона.
 *
 * ЗАЧЕМ. Владелец 16.09.2026 решил соседний проект не гасить — у него там
 * своя работа. Значит тишины не будет никогда, и единственный честный ход:
 * мерить рядом с соседями, но ЗНАТЬ, что они делали в эту минуту. Покой
 * до прогона (`make conditions`) на это не отвечает: сосед просыпается
 * по своему расписанию, и разбудить его может как раз наша нагрузка
 * на общую машину.
 *
 * ⚠️ ОТДЕЛЬНЫМ ПРОЦЕССОМ, И ЭТО НЕ УКРАШЕНИЕ. Опрос Docker — это запуск
 * внешней программы на секунду с лишним. В процессе, который меряет время
 * ответа, он встал бы прямо в измеряемое число: прибор снова мерил бы себя.
 * Та же причина, по которой отдельными процессами живут держатели вкладок.
 */

import { sample } from "./conditions.mjs";

/** Как часто спрашиваем. Реже, чем длится прогон, — иначе проб будет одна. */
const EVERY_MS = Number(process.env.STRANGERS_EVERY_MS ?? 4000);

const takes = [];
let running = false;

async function watch() {
  while (running) {
    try {
      takes.push(sample().filter((one) => !one.ours));
    } catch {
      // Docker не ответил — проба потеряна, но прогон это не рушит.
      // Сколько проб вышло, видно в отчёте числом.
    }
    if (!running) return;
    await new Promise((resolve) => setTimeout(resolve, EVERY_MS));
  }
}

/** Что чужие брали в каждой пробе: сумма по всем их контейнерам. */
function loads() {
  return takes.map((take) => take.reduce((sum, one) => sum + one.cpu, 0));
}

/** Кто из чужих всплеснул выше всех за весь прогон. */
function loudest() {
  let worst = null;
  for (const take of takes) {
    for (const one of take) {
      if (!worst || one.cpu > worst.cpu) worst = one;
    }
  }
  return worst;
}

process.on("message", (message) => {
  if (message.start) {
    running = true;
    void watch();
    process.send({ watching: true });
    return;
  }

  if (message.stop) {
    running = false;
    const all = loads();
    const sorted = [...all].sort((a, b) => a - b);
    process.send({
      samples: all.length,
      // Середина, а не среднее: один всплеск не должен красить весь прогон.
      usual: sorted[Math.floor(sorted.length / 2)] ?? 0,
      peak: all.length > 0 ? Math.max(...all) : 0,
      loudest: loudest()?.name ?? null,
    });
    process.exit(0);
  }
});
