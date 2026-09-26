import { SEARCH_TOTAL_CAP } from "@amplifie/contract";
import { CaretDown, CaretUp, X } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useSearch } from "../../data/useSearch.js";
import { clearHighlight, highlightWords } from "../../shared/highlightWords.js";
import { CommandField } from "../../shared/ui/command-field.js";

/**
 * Поиск внутри открытого чата: полоса под шапкой (task-106).
 *
 * ⚠️ ПОЛОСА, А НЕ ОКНО. Искать в чате — значит ходить по его же ленте,
 * и окно закрыло бы ровно то, на что смотрят. У Telegram Desktop это тоже
 * полоса со счётчиком «N из M» и двумя стрелками (`ComposeSearch`).
 *
 * ⚠️ СЧЁТЧИК ПОКАЗЫВАЕТ ТО, ЧТО СЧИТАЛ СЕРВЕР. Число всего приходит
 * с потолком: выше него «1000+», а не выдуманное точное. Пока сервер
 * не ответил, счётчика нет вовсе — пустое место честнее нуля.
 *
 * ⚠️ ПЕРЕХОД — ТЕМ ЖЕ АДРЕСОМ, ЧТО ЦИТАТА (`onOpen`). Второго способа
 * доехать до реплики не заводим: они разошлись бы (task-099).
 */
export function ChatSearchBar({
  room,
  onOpen,
  onClose,
}: {
  /** Где ищем. Полоса живёт только при открытом чате. */
  room: string;
  onOpen: (seq: number) => void;
  onClose: () => void;
}) {
  const { query, setQuery, words, state, loadMore } = useSearch(room);
  /** Какое попадание показано. Ноль — первое. */
  const [at, setAt] = useState(0);

  const items = state.kind === "найдено" ? state.items : [];
  const total = state.kind === "найдено" ? state.total : undefined;
  const current = items[at];

  // Новая выдача — снова с первого попадания: номер прежней строки
  // в новой ничего не значит.
  // biome-ignore lint/correctness/useExhaustiveDependencies: важна смена самой выдачи
  useEffect(() => setAt(0), [state.kind === "найдено" ? state.items[0]?.id : null]);

  // Показываем то попадание, на котором стоим. Ведёт адрес, как у цитаты.
  useEffect(() => {
    if (current) onOpen(current.seq);
  }, [current, onOpen]);

  /**
   * Подсветить слово в показанной реплике (владелец 26.09).
   *
   * ⚠️ ЖДЁМ, ПОКА РЕПЛИКА НАРИСУЕТСЯ. Переход к давнему попаданию
   * догружает окно ленты — строки ещё нет в миг выбора. Смотрим раз
   * в кадр, но не дольше трёх секунд.
   */
  const seq = current?.seq;
  const said = words.join(" ");
  // biome-ignore lint/correctness/useExhaustiveDependencies: слова несёт `said`
  useEffect(() => {
    if (seq === undefined || said === "") return clearHighlight();
    let frame = 0;
    const until = performance.now() + 3000;
    const look = () => {
      const body = document.querySelector(`[data-seq="${seq}"] [data-body]`);
      if (body) highlightWords(body, words);
      else if (performance.now() < until) frame = requestAnimationFrame(look);
    };
    look();
    return () => cancelAnimationFrame(frame);
  }, [seq, said]);

  // Полоса закрылась — подсветка уходит вместе с ней.
  useEffect(() => clearHighlight, []);

  /**
   * Escape закрывает полосу, где бы ни был фокус.
   *
   * ⚠️ ОДНОГО ОБРАБОТЧИКА В ПОЛЕ МАЛО. Нажав стрелку мышью, человек уводит
   * фокус на кнопку — и Escape до поля уже не доходит; поймано прогоном.
   * Слушаем окно, но уступаем верхнему слою: у открытого окна свой Escape,
   * и закрывать оба разом нельзя.
   */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector('[role="dialog"]')) return;
      onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /**
   * Шаг по попаданиям. Подходя к концу загруженного, просим следующую
   * страницу — так же поступает Telegram (`searchMore`).
   */
  const step = (by: 1 | -1) => {
    const next = at + by;
    if (next < 0 || next >= items.length) return;
    setAt(next);
    if (next >= items.length - 3) loadMore();
  };

  return (
    <search
      aria-label="Поиск в чате"
      className="flex shrink-0 items-center gap-1 border-b border-line bg-panel pr-2"
    >
      <div className="min-w-0 flex-1">
        <CommandField
          value={query}
          label="Что искать в чате"
          placeholder="Поиск в этом чате"
          onChange={setQuery}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              step(event.shiftKey ? -1 : 1);
            }
            if (event.key === "Escape") onClose();
          }}
        />
      </div>

      <Counter state={state.kind} at={at} shown={items.length} total={total} />

      <button
        type="button"
        aria-label="Предыдущее совпадение"
        title="Предыдущее совпадение (Shift+Enter)"
        disabled={at === 0}
        onClick={() => step(-1)}
        className="grid size-8 shrink-0 place-items-center rounded bg-transparent text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-40"
      >
        <CaretUp className="size-4" />
      </button>
      <button
        type="button"
        aria-label="Следующее совпадение"
        title="Следующее совпадение (Enter)"
        disabled={items.length === 0 || at >= items.length - 1}
        onClick={() => step(1)}
        className="grid size-8 shrink-0 place-items-center rounded bg-transparent text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-40"
      >
        <CaretDown className="size-4" />
      </button>
      <button
        type="button"
        aria-label="Закрыть поиск в чате"
        title="Закрыть (Escape)"
        onClick={onClose}
        className="grid size-8 shrink-0 place-items-center rounded bg-transparent text-muted transition-colors hover:bg-raised hover:text-ink"
      >
        <X className="size-4" />
      </button>
    </search>
  );
}

/**
 * «3 из 17» — какое попадание показано и сколько их всего.
 *
 * ⚠️ ПУСТО, ПОКА НЕЧЕГО СКАЗАТЬ. У Telegram счётчик пуст, когда число всего
 * неизвестно: выдуманное «из 20» хуже отсутствующего. «Ничего не найдено»
 * говорится словами — это не то же, что «ещё ищем».
 */
function Counter({
  state,
  at,
  shown,
  total,
}: {
  state: "пусто" | "коротко" | "ищем" | "найдено" | "отказ";
  at: number;
  shown: number;
  total: number | undefined;
}) {
  if (state === "коротко") return <Quiet>два знака</Quiet>;
  if (state === "отказ") return <Quiet>не искалось</Quiet>;
  if (state !== "найдено" || shown === 0) {
    return state === "найдено" ? <Quiet>ничего нет</Quiet> : null;
  }
  const all = total === undefined ? shown : total;
  const many = total !== undefined && total >= SEARCH_TOTAL_CAP;
  return (
    <p className="shrink-0 px-1 text-aside text-muted tabular-nums" aria-live="polite">
      {at + 1} из {all}
      {many ? "+" : ""}
    </p>
  );
}

function Quiet({ children }: { children: React.ReactNode }) {
  return <p className="shrink-0 px-1 text-aside text-muted">{children}</p>;
}
