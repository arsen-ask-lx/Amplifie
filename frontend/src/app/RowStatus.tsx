import { At, PushPin } from "@phosphor-icons/react";

/**
 * Состояние строки панели — один значок слева от названия (Р-044).
 *
 * ⚠️ ЗНАЧОК, А НЕ ЧИСЛО. Числа плашками справа владелец назвал «очень плохо
 * смотрится»: на пяти чатах панель пестрела, а «24» в оживлённом канале
 * не говорит, что там важно. Новое — точкой и жирным названием, зов — `@`.
 * Сколько именно пропущено, видно внутри чата чертой «Непрочитанные».
 *
 * ⚠️ ОДИН ЗНАК НА СТРОКУ, И ПОРЯДОК ВАЖНОСТИ ЖИВЁТ ЗДЕСЬ. Сюда же лягут
 * состояния агента (второй шаг Р-044): упал → позвали → ответил →
 * работает → новое. Разнеси правило по строкам — чат и папка разошлись бы.
 */
export type RowState = "none" | "unread" | "mention" | "pinned";

export function rowState({
  unread,
  mentions,
  pinned = false,
}: {
  unread: number;
  mentions: number;
  pinned?: boolean;
}): RowState {
  if (mentions > 0) return "mention";
  if (unread > 0) return "unread";
  return pinned ? "pinned" : "none";
}

/** Постоянное место в 16 px: значок меняется, а название не двигается. */
export function StatusMark({ state }: { state: RowState }) {
  return (
    <span
      data-status={state}
      aria-hidden="true"
      className="grid size-4 shrink-0 place-items-center"
    >
      {state === "mention" ? <At className="size-4 text-accent" weight="bold" /> : null}
      {state === "unread" ? <span className="size-2 rounded-pill bg-ink" /> : null}
      {state === "pinned" ? <PushPin className="size-3.5 opacity-60" weight="fill" /> : null}
      {state === "none" ? (
        <span className="size-2 rounded-pill border-[1.5px] border-muted" />
      ) : null}
    </span>
  );
}

/**
 * Числа — только для читалки экрана.
 *
 * ⚠️ ЧИСЛО УШЛО С ГЛАЗ, НО НЕ ИЗ ДОСТУПНОГО ИМЕНИ. Вслух «Смета» без «двух
 * непрочитанных» теряет то, что зрячий видит жирным шрифтом. Слово входит
 * в имя кнопки: «Смета непрочитанных: 2» — поэтому проверки ищут строку
 * по началу имени (fixtures.ts).
 */
export function SpokenCounts({ unread, mentions }: { unread: number; mentions: number }) {
  const cap = (count: number) => (count > 999 ? "999+" : count);
  return (
    <>
      {mentions > 0 ? <span className="sr-only">упоминаний: {cap(mentions)}</span> : null}
      {unread > 0 ? <span className="sr-only">непрочитанных: {cap(unread)}</span> : null}
    </>
  );
}
