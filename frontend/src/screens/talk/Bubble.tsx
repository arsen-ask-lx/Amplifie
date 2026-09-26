import { Check } from "@phosphor-icons/react";
import { RichText } from "../../shared/RichText.js";
import { ContextMenu, ContextMenuTrigger } from "../../shared/ui/context-menu.js";
import { Actions, type Deeds, type Picking } from "./Actions.js";
import { Corner, Spacer } from "./Corner.js";
import { Quote } from "./Quote.js";
import { forDisplay, type Row } from "./rows.js";

/**
 * Одна реплика в ленте.
 *
 * ⚠️ ОДИН СТОЛБЕЦ, А НЕ ДВЕ СТОРОНЫ (владелец, 2026-09-08). Было как
 * в Телеграме НА ТЕЛЕФОНЕ: свои справа, чужие слева. Стало как в Телеграме
 * НА ДЕСКТОПЕ: все реплики в одном столбце, свои отличаются цветом пузыря.
 * Проверено по их обсуждениям — двусторонняя раскладка у них до сих пор
 * в просьбах пользователей, а не в программе.
 *
 * Правила «кто с кем в группе» живут в `rows.ts`, группа — в `Group.tsx`,
 * меню — в `Actions.tsx`.
 * Разделено не ради красоты: гейт размера файла был прав, 514 строк
 * означали, что сюда дописывают всё, что рядом по смыслу.
 */

/**
 * Щелчок по строке в режиме выделения.
 *
 * ⚠️ РЯДОМ С НИМ ОБЯЗАН БЫТЬ ОБРАБОТЧИК КЛАВИАТУРЫ. Строка — не кнопка,
 * и без него она нажимается только мышью: тот, кто ходит по интерфейсу
 * с клавиатуры, выделить ничего не сможет.
 */
function pickHandlers(row: Row, picking: Picking | null) {
  if (!picking) return {};
  return {
    onClick: () => picking.toggle(row.message),
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      picking.toggle(row.message);
    },
  };
}

/** Галочка выделения справа от пузыря. */
function Tick({ row, picking, chosen }: { row: Row; picking: Picking | null; chosen: boolean }) {
  if (!picking) return null;
  return (
    <button
      type="button"
      aria-pressed={chosen}
      aria-label={chosen ? "Снять выделение" : "Выделить"}
      onClick={(event) => {
        // Щелчок по галочке не должен сработать дважды: строка выше
        // слушает то же событие.
        event.stopPropagation();
        picking.toggle(row.message);
      }}
      className={[
        "mt-auto mb-1 ml-2 grid size-5 shrink-0 place-items-center rounded-pill border transition-colors",
        chosen ? "border-accent bg-accent text-on-accent" : "border-edge bg-transparent",
      ].join(" ")}
    >
      {chosen ? <Check className="size-3" /> : null}
    </button>
  );
}

/** Шапка пузыря: откуда переслано и кто говорит. */
function Head({ row }: { row: Row }) {
  const soft = row.mine;
  return (
    <>
      {row.message.forwardedFrom ? (
        <span
          className={[
            "mb-0.5 block text-mark italic",
            soft ? "text-muted-on-soft" : "text-muted",
          ].join(" ")}
        >
          Переслано от {row.message.forwardedFrom}
        </span>
      ) : null}

      {row.first ? (
        <span
          className={[
            "mb-0.5 block text-aside font-medium",
            // Внутри своего пузыря — своя роль: он залит, и обычный
            // текстовый акцент на нём не читается.
            soft ? "text-ink-on-soft" : "text-accent-ink",
          ].join(" ")}
        >
          {row.message.author.name}
        </span>
      ) : null}
    </>
  );
}

/**
 * Реплика: пузырь, цитата, подпись и меню по правой кнопке.
 *
 * Шапка и подпись вынесены отдельными кусками не ради красоты: гейт
 * сложности был прав — в одной функции набралось семь условий поверх
 * разметки, и такое читается только целиком.
 */
export function Bubble({
  row,
  deeds,
  onGo,
  picking,
}: {
  row: Row;
  deeds: Deeds;
  onGo: (seq: number) => void;
  /** Идёт выделение. `null` — обычный режим. */
  picking: Picking | null;
}) {
  // Неотправленное не выделяется (task-111): сервер о нём не знает,
  // и «удалить выделенное» ушло бы в пустоту.
  const pickable = row.message.state ? null : picking;
  const chosen = pickable?.chosen.has(row.message.id) ?? false;
  const pick = pickHandlers(row, pickable);
  /**
   * Есть ли в реплике блок кода — от этого зависит предел ширины пузыря.
   *
   * Проверка по самой строке, а не по разобранным кускам: разбирать текст
   * дважды на каждую перерисовку ленты дороже, чем поискать в нём ограду.
   * Ложное срабатывание на одинокой ограде безобидно — пузырь всего лишь
   * получит право быть шире, чем ему нужно.
   */
  const hasBlock = row.message.body.includes("```");
  return (
    // data-seq — по нему лента находит реплику при переходе из цитаты.
    <article
      data-seq={row.message.seq}
      /* `flex` здесь не для раскладки, а чтобы область меню по правой
         кнопке стала блочной: Radix рисует её строчным тегом, а строчный
         не слушается ни ширины, ни полей — пузыри складывались в полоску
         шириной в один знак. */
      /* `w-full`, чтобы подсветка перехода легла ПОЛОСОЙ, а не по контуру
         пузыря: без этого строка сжимается до ширины текста, и заливать
         нечего. Пузырь внутри всё равно ограничен своими 52 знаками. */
      className={[
        "msg flex w-full max-w-full",
        row.fresh ? "msg-fresh" : "",
        // В режиме выделения щелчок по всей строке переключает выбор,
        // поэтому строка целиком становится нажимаемой и подсвечивается.
        pickable ? "cursor-pointer rounded-sm" : "",
        chosen ? "bg-selected" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={pick.onClick}
      onKeyDown={pick.onKeyDown}
    >
      <ContextMenu>
        <ContextMenuTrigger
          className={[
            // ⚠️ `text-body` СТОИТ ЗДЕСЬ РАДИ `ch`, А НЕ РАДИ ВИДА. Предел
            // ширины задан в знаках, а знак считается по шрифту ТОГО ЖЕ
            // элемента: размер текста стоял только на внутренней строке,
            // и предел молча раздувался с 483 до 721 пикселя.
            // 52 знака — около 480 пикселей, как у Телеграма на десктопе.
            "relative min-w-0 px-3 py-2 text-left text-body shadow-raised",
            // ⚠️ ПУЗЫРЬ С БЛОКОМ КОДА РАЗДАЁТСЯ ШИРЕ, И ЭТО ПОВЕДЕНИЕ
            // ТЕЛЕГРАМА, А НЕ ПОСЛАБЛЕНИЕ. 52 знака — предел для СВЯЗНОГО
            // ТЕКСТА: длинная строка читается тем хуже, чем она длиннее,
            // и это про чтение слева направо. Таблица и код читаются
            // иначе — их смотрят целиком, и лишний перенос там не помощь,
            // а порча. Поэтому предел не снимается, а меняется на другой:
            // до ширины ленты, но не больше.
            hasBlock ? "max-w-full" : "max-w-[52ch]",
            // Хвостик слева у обоих: пузырь растёт от кружка, а кружок
            // теперь один и тот же с одной стороны.
            "rounded-lg rounded-bl-sm",
            row.mine
              ? "border border-accent-soft-edge bg-accent-soft text-ink-on-soft"
              : "border border-line bg-card text-ink",
          ].join(" ")}
        >
          <Head row={row} />

          {/* Цитата ВНУТРИ пузыря и выше текста: она объясняет, к чему
              относится сказанное, и потому обязана быть прочитана первой. */}
          {row.message.replyTo ? (
            <Quote
              quote={row.message.replyTo}
              tone={row.mine ? "на заливке" : "обычный"}
              onGo={() => {
                const seq = row.message.replyTo?.seq;
                if (seq !== undefined) onGo(seq);
              }}
            />
          ) : null}

          <span data-body className="block text-body leading-snug break-words whitespace-pre-wrap">
            <RichText body={forDisplay(row.message.body)} />
            {/* Распорка под время. Для чтения вслух её нет. */}
            <Spacer row={row} />
          </span>

          <Corner row={row} onRetry={deeds.onRetry} />
        </ContextMenuTrigger>
        <Actions row={row} deeds={deeds} />
      </ContextMenu>

      {/* Галочка справа от пузыря, а не внутри: внутри она соревновалась бы
          с текстом за место и уезжала бы под время. */}
      <Tick row={row} picking={pickable} chosen={chosen} />
    </article>
  );
}
