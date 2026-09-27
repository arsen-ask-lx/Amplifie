import { useCallback, useMemo, useRef } from "react";
import { api, type SyncLine } from "./api.js";
import { catchUpWith } from "./catchUp.js";
import type { FeedCommand } from "./feedState.js";
import { useLiveUpdates } from "./useLiveUpdates.js";
import type { Rooms } from "./useRooms.js";

/**
 * Лента и курсор догона: как изменения доезжают до открытой ленты (task-099).
 *
 * ⚠️ ОТДЕЛЬНЫМ ЗНАНИЕМ ПО ШВУ, А НЕ ПО РАЗМЕРУ. Загрузка ленты знает про
 * курсор ровно одно — «страница пришла, вот её голова» (`settleCursor`).
 * Всё остальное — курсор, признак готовности, приём строк догона, поток —
 * отвечает на другой вопрос: не «что показать», а «как узнать, что изменилось».
 * Когда у ленты появился второй край, правило стыка с живым легло сюда же,
 * и `useChat` перерос свой предел — шов проходит здесь.
 */

/**
 * Сколько реплик разговора живёт в ленте (Р-023).
 *
 * ⚠️ ЧИСЛО — ОЦЕНКА, ПОДТВЕРЖДЁННАЯ ЗАМЕРОМ: 360 узлов перерисовываются
 * за 17 мс при пороге виртуализации в 100. Запас шестикратный, поэтому
 * библиотека не нужна.
 */
const WINDOW_SIZE = 300;

export function useFeedSync({
  dispatch,
  currentId,
  currentIdRef,
  following,
  rooms,
  onTrouble,
  onSessionEnded,
}: {
  dispatch: (command: FeedCommand) => void;
  currentId: string | null;
  currentIdRef: { current: string | null };
  /** Человек внизу ленты — значит можно резать сверху. */
  following: { current: boolean };
  rooms: Rooms;
  onTrouble: (message: string | null) => void;
  onSessionEnded: () => void;
}): {
  /**
   * Страница ленты пришла: поставить курсор по её голове и догнать.
   * `atEnd` — страница доходит до живого конца.
   */
  settleCursor: (head: number, atEnd: boolean) => void;
} {
  // Курсор догона живёт в ref, а не в состоянии: он меняется чаще, чем экран,
  // и перерисовывать ленту ради него незачем.
  const cursor = useRef(0);

  /**
   * Лента уже встала на курсор — значит догонять есть от чего.
   *
   * ⚠️ ОТДЕЛЬНЫМ ПРИЗНАКОМ, А НЕ «КУРСОР БОЛЬШЕ НУЛЯ». В новом пространстве
   * без единой реплики голова равна нулю и ПОСЛЕ загрузки — первая редакция
   * путала это с «ещё не загрузили» и не догоняла после обрыва вовсе.
   * Поймано UI-сценарием task-093 на пустом канале.
   */
  const feedReady = useRef(false);

  /**
   * Какой разговор открыт — ссылкой, ради подписки на поток.
   *
   * Подписка не имеет права пересоздаваться при переходе между чатами:
   * новое соединение на каждый переход — это новый запрос к серверу
   * и потерянные между ними звонки.
   */
  const openRef = useRef<string | null>(null);
  openRef.current = currentId;

  /**
   * Разложить приехавшее догоном: в ленту и в закреплённое.
   *
   * ⚠️ СЧЁТЧИКИ ЧУЖИХ КОМНАТ ОБНОВЛЯЕТ ЗВОНОК, А НЕ ДОГОН. Догон приносит
   * реплики всего пространства, но в ленту попадают только реплики
   * ОТКРЫТОГО разговора (Р-023). Число у соседнего канала растёт потому,
   * что каждый звонок перечитывает список, — счётчик живёт на сервере
   * (Р-029). Здесь стояло второе перечитывание на то же событие: замер
   * 11.09 — пять сообщений давали десять полных списков вместо пяти.
   */
  const accept = useCallback(
    (arrived: SyncLine[]) => {
      dispatch({
        type: "arrived",
        lines: arrived,
        openId: currentIdRef.current,
        keep: following.current ? WINDOW_SIZE : undefined,
      });
    },
    [dispatch, currentIdRef, following],
  );

  /** Догон до конца, один за раз (`catchUp.ts`). */
  const catchUp = useMemo(() => catchUpWith(api.sync, cursor, accept), [accept]);

  // Поток, посылки, догон при восстановлении и его страховка — отдельным
  // знанием (task-093).
  const catchUpSoon = useLiveUpdates({
    catchUp,
    cursor,
    feedReady,
    accept,
    rooms,
    openRef,
    onTrouble,
    onSessionEnded,
  });

  /**
   * ⚠️ СТРАНИЦА В КОНЦЕ ОТКАТЫВАЕТ КУРСОР К СВОЕЙ ГОЛОВЕ (task-099). Пока
   * страница летела, живое событие могло не пройти край ленты и не влиться,
   * а курсор уже стоит за ним — страница его не содержит, событие второй
   * раз не придёт. Голова читается сервером ДО строк, поэтому всё не новее
   * неё в странице есть, а всё новее привезёт догон. Разница — время полёта
   * одного запроса: догон берёт её из хвоста в памяти, лишнее сливается
   * по идентификатору.
   *
   * Свежая вкладка нигде не была — ей курсор ставится на голову, как всегда:
   * откат к нулю переиграл бы всё пространство (Д-19). Страница не в конце
   * курсор не откатывает: пропущенное за её краем привезёт страница с края.
   */
  const settleCursor = useCallback(
    (head: number, atEnd: boolean) => {
      cursor.current =
        feedReady.current && atEnd
          ? Math.min(cursor.current, head)
          : Math.max(cursor.current, head);
      feedReady.current = true;
      // Догон — у своего хозяина повтора: его отказ не отказ ленты (task-096).
      catchUpSoon();
    },
    [catchUpSoon],
  );

  return { settleCursor };
}
