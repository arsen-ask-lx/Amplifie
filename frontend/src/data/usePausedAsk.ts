import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Спросить сервер после паузы в наборе — общее у поиска по сообщениям
 * (task-100) и поиска чата в окне «Переслать» (task-117).
 *
 * ⚠️ ПАУЗА И ОТМЕНА — НЕ УКРАШЕНИЕ, А ЦЕНА. Без паузы каждая буква — запрос;
 * без отмены ответ на «дог» мог приехать позже ответа на «договор» и
 * затереть его. Telegram Desktop ждёт 900 мс и отменяет прежний запрос
 * (`dialogs_widget.cpp`). Порог частоты `SEARCH` на сервере посчитан
 * от этих 400 мс — поменяешь паузу, пересчитай и его.
 *
 * ⚠️ ОТВЕТ ПОМНИТ СВОЙ КЛЮЧ. Между буквой и эффектом есть кадр, где строка
 * уже новая, а на экране старая выдача. Enter в этот кадр не должен
 * отправить реплику в чат из чужой выдачи — хозяин окна сверяет ключ.
 *
 * Ответ запоминается по ключу, пока окно открыто: стёр букву и вернул —
 * запроса нет. Так же у Telegram Desktop.
 */

/** Пауза после набора. */
const PAUSE_MS = 400;

export type AskState<T> =
  | { kind: "пусто" }
  | { kind: "коротко" }
  | { kind: "ищем" }
  | { kind: "найдено"; key: string; value: T }
  | { kind: "отказ" };

export function usePausedAsk<T>({
  key,
  blank,
  short,
  ask,
}: {
  /** Что спрашиваем: смена ключа — новый запрос, прежний отменяется. */
  key: string;
  /** Поле пустое — спрашивать нечего. */
  blank: boolean;
  /** Набранного мало, чтобы спрашивать. */
  short: boolean;
  ask: (signal: AbortSignal) => Promise<T>;
}) {
  const [state, setState] = useState<AskState<T>>({ kind: "пусто" });
  /** Попытка — счётчиком: «Повторить» спрашивает заново тем же эффектом. */
  const [attempt, setAttempt] = useState(0);
  const cache = useRef(new Map<string, T>());
  // Свежая функция запроса без перезапуска эффекта: её тело зависит от
  // строки, а строку уже несёт ключ.
  const asking = useRef(ask);
  asking.current = ask;

  useEffect(() => {
    void attempt;
    if (blank) return setState({ kind: "пусто" });
    if (short) return setState({ kind: "коротко" });
    const cached = cache.current.get(key);
    if (cached !== undefined) return setState({ kind: "найдено", key, value: cached });

    setState({ kind: "ищем" });
    const stop = new AbortController();
    const timer = window.setTimeout(() => {
      asking
        .current(stop.signal)
        .then((value) => {
          cache.current.set(key, value);
          setState({ kind: "найдено", key, value });
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
  }, [key, blank, short, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { state, setState, retry };
}
