import { searchWords } from "@amplifie/contract";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type SearchHit, type SearchPage } from "./api.js";

/**
 * Поиск по сообщениям в окне Ctrl+K (task-100): когда спрашивать сервер
 * и что показывать, пока он отвечает.
 *
 * ⚠️ ПАУЗА И ОТМЕНА — НЕ УКРАШЕНИЕ, А ЦЕНА. Без паузы каждая буква «договор» —
 * запрос; без отмены ответ на «дог» мог приехать позже ответа на «договор»
 * и затереть его. Telegram Desktop ждёт 900 мс и отменяет прежний запрос
 * (`dialogs_widget.cpp`); здесь пауза короче, потому что выдача — не список
 * чатов, а уже сами сообщения.
 *
 * ⚠️ ПЕРВАЯ СТРАНИЦА ЗАПОМИНАЕТСЯ ПО СТРОКЕ, ПОКА ОКНО ОТКРЫТО. Стёр букву
 * и вернул — ответ уже есть, запроса нет. Так же у Telegram Desktop.
 */

/** Пауза после набора. */
const PAUSE_MS = 400;

export type SearchState =
  | { kind: "пусто" }
  | { kind: "коротко" }
  | { kind: "ищем" }
  | {
      kind: "найдено";
      items: SearchHit[];
      next: number | null;
      /** Грузится следующая страница. */
      more: boolean;
      /** Следующая страница не загрузилась: найденное остаётся, «Повторить» — ниже. */
      broken: boolean;
    }
  | { kind: "отказ" };

export function useSearch() {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<SearchState>({ kind: "пусто" });
  /** Попытка — счётчиком: «Повторить» спрашивает заново тем же эффектом. */
  const [attempt, setAttempt] = useState(0);
  const cache = useRef(new Map<string, SearchPage>());
  const words = searchWords(query);
  const key = words.join(" ");
  // Признак, а не сама строка: пробел в конце не меняет слов и не должен
  // перезапускать поиск.
  const blank = query.trim() === "";

  useEffect(() => {
    void attempt;
    if (blank) return setState({ kind: "пусто" });
    if (key === "") return setState({ kind: "коротко" });
    const cached = cache.current.get(key);
    if (cached) return setState({ kind: "найдено", ...cached, more: false, broken: false });

    setState({ kind: "ищем" });
    const stop = new AbortController();
    const timer = window.setTimeout(() => {
      api
        .search(key, { signal: stop.signal })
        .then((page) => {
          cache.current.set(key, page);
          setState({ kind: "найдено", ...page, more: false, broken: false });
        })
        .catch(() => {
          // Отменённый — не отказ: его сменил следующий запрос. Настоящий
          // отказ показывается строкой с «Повторить».
          if (!stop.signal.aborted) setState({ kind: "отказ" });
        });
    }, PAUSE_MS);
    return () => {
      window.clearTimeout(timer);
      stop.abort();
    };
  }, [key, blank, attempt]);

  /** Следующая страница — к прокрутке до низа выдачи. Одна за раз. */
  const loadMore = useCallback(() => {
    if (state.kind !== "найдено" || state.next === null || state.more) return;
    const before = state.next;
    setState({ ...state, more: true, broken: false });
    api
      .search(key, { before })
      .then((page) =>
        setState((was) =>
          was.kind === "найдено"
            ? {
                kind: "найдено",
                items: [...was.items, ...page.items],
                next: page.next,
                more: false,
                broken: false,
              }
            : was,
        ),
      )
      .catch(() => {
        // Найденное не теряется: строка «Повторить» под списком.
        setState((was) => (was.kind === "найдено" ? { ...was, more: false, broken: true } : was));
      });
  }, [state, key]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { query, setQuery, words, state, loadMore, retry };
}
