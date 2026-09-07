import { z } from "zod";

/**
 * Конверт с действиями: что модель ответила и что предлагает сделать (Р-017).
 *
 * ГЛАВНОЕ ПРАВИЛО ЭТОГО ФАЙЛА: **непонятый ответ никогда не превращается
 * в действие.** Не разобралось — весь вывод считается простым ответом,
 * действий ноль. Не падение и не догадка.
 *
 * ПОЧЕМУ СТУПЕНИ, А НЕ ОДНА ПОПЫТКА. Ресёрч 2026 года даёт числа:
 * подсказкой добиваются 80–95 % годных ответов, и самая частая поломка —
 * обёртка в тройные кавычки, даже когда просили без них. Терять действие
 * из-за обёртки обидно; догадываться о намерении — опасно. Ступени
 * восстанавливают форму, не трогая смысл.
 *
 * ⚠️ СПИСОК ВИДОВ ЗАКРЫТЫЙ. Неизвестный вид молча отбрасывается.
 * Добавить действие — значит дописать строку сюда, а не разрешить модели
 * называть что угодно.
 */

/** Что агенту вообще позволено предлагать. Пока ровно одно. */
const KINDS = ["создать-задачу"] as const;

/** Не больше действий на один ответ: одно обращение — не двадцать задач. */
export const LIMIT = 3;

/** Название задачи длиннее — это болтливость модели, а не смысл. */
const TEXT_MAX = 200;

const shape = z.object({
  ответ: z.string(),
  действия: z
    .array(z.object({ вид: z.string(), текст: z.string() }))
    .optional()
    .default([]),
});

export interface Action {
  kind: (typeof KINDS)[number];
  text: string;
}

export interface Envelope {
  text: string;
  actions: Action[];
}

/** Ступень 2: снять обёртку из тройных кавычек. */
function unfence(raw: string): string | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/u.exec(raw);
  return fenced?.[1]?.trim() ?? null;
}

/** Ступень 3: вырезать от первой открывающей скобки до последней закрывающей. */
function between(raw: string): string | null {
  const from = raw.indexOf("{");
  const to = raw.lastIndexOf("}");
  return from >= 0 && to > from ? raw.slice(from, to + 1) : null;
}

function asObject(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    // Не годится — пробуем следующую ступень. Молчание здесь осознанное:
    // неудача разбора это не ошибка, а ожидаемый ход событий.
    return null;
  }
}

/** Отобрать действия, которые нам позволено выполнять. */
function allowed(raw: Array<{ вид: string; текст: string }>): Action[] {
  const kept: Action[] = [];
  for (const one of raw) {
    if (kept.length >= LIMIT) break;
    const kind = KINDS.find((known) => known === one.вид);
    const text = one.текст.trim().slice(0, TEXT_MAX);
    if (!kind || !text) continue;
    kept.push({ kind, text });
  }
  return kept;
}

/**
 * Прочитать ответ модели как конверт.
 *
 * Никогда не бросает: любой вход — это либо конверт, либо простой ответ.
 */
export function readEnvelope(raw: string): Envelope {
  for (const candidate of [raw, unfence(raw), between(raw)]) {
    if (!candidate) continue;

    const parsed = shape.safeParse(asObject(candidate));
    if (!parsed.success) continue;

    return { text: parsed.data.ответ, actions: allowed(parsed.data.действия) };
  }

  // Ступень 4 — правило, а не запасной путь: не поняли, значит действий нет.
  return { text: raw, actions: [] };
}
