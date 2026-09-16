import { useEffect } from "react";
import type { ChangeEvent, Message, SyncLine } from "./api.js";
import { type Carried, carried } from "./carried.js";
import { openLiveStream } from "./liveStream.js";
import { retrying } from "./retrying.js";
import type { Rooms } from "./useRooms.js";

/**
 * Живые обновления ленты и панели: поток, посылки, догон и его страховка.
 *
 * ⚠️ ОТДЕЛЬНЫМ ЗНАНИЕМ, А НЕ ЭФФЕКТОМ ВНУТРИ `useChat` (task-093). Здесь
 * живёт всё, что отвечает на вопрос «как вкладка узнаёт о чужих изменениях
 * и что делает, когда связь рвалась», — у этого знания одна причина
 * меняться. В `useChat` оно лежало рядом с отправкой, цитатами и загрузкой
 * ленты, и файл давно перерос свой предел.
 *
 * Что вкладка делает — по таблице состояний плана task-093:
 * - посылка сразу за курсором — применяется без запроса (task-085, task-092);
 * - разрыв, событие без посылки, новое подключение, возврат во вкладку,
 *   страховочный таймер — догон, у которого ОДИН хозяин повторов;
 * - 401 от потока или догона — вход, а не вечные попытки.
 */

/** Показывается, пока связь не вернулась; гаснет сама. */
export const TROUBLE = "Обновления не доходят — пробуем снова";

/** Сколько отказов подряд терпим молча: один-два — обычная жизнь сети. */
const QUIET_FAILURES = 3;

/**
 * Страховочный догон — раз в полторы-две с половиной минуты, пока вкладка видна.
 *
 * ⚠️ ЗАЧЕМ, ЕСЛИ ЕСТЬ ПОТОК. Событие может потеряться без разрыва
 * соединения: реплика записана, а звонок не ушёл (task-093, находка ⑤),
 * либо прокси держит полуживое соединение, по которому не идёт ничего.
 * Ни переподключение, ни возврат во вкладку этого не вылечат. Урок чужого
 * опыта (Audit, realtime-kit №9) — широкий догон по таймеру с разбросом.
 * Цена — около двух десятков догонов в секунду на 3000 видимых вкладок,
 * почти все из хвоста в памяти; порог пересмотра — в плане.
 */
const SAFETY_MIN_MS = 90_000;
const SAFETY_SPREAD_MS = 60_000;

/**
 * Разобрать данные события `changed`. Не разобралось — считаем «изменилось
 * пространство»: список обновится, а лишнего догона не будет.
 */
function changeOf(data: string): ChangeEvent {
  try {
    const parsed = JSON.parse(data || "{}") as Partial<ChangeEvent>;
    return {
      conversation: parsed.conversation ?? null,
      ...(parsed.line ? { line: parsed.line } : {}),
      // Кого позвали (task-092): разбирать текст здесь — вторая разметка
      // рядом с серверной (Р-020).
      ...(Array.isArray(parsed.mentions) ? { mentions: parsed.mentions } : {}),
    };
  } catch {
    return { conversation: null };
  }
}

export function useLiveUpdates(options: {
  catchUp: () => Promise<void>;
  cursor: { current: number };
  /** Лента встала на курсор: до этого догонять рано — ушли бы с нуля за всем пространством. */
  feedReady: { current: boolean };
  accept: (lines: SyncLine[]) => void;
  rooms: Pick<Rooms, "refresh" | "applied">;
  /** Какой разговор открыт — ссылкой: подписка не пересоздаётся от переходов. */
  openRef: { current: string | null };
  /** Строка беды: текст — показать, `null` — погасить свою. */
  onTrouble: (message: string | null) => void;
  onSessionEnded: () => void;
}): void {
  const { catchUp, cursor, feedReady, accept, rooms, openRef, onTrouble, onSessionEnded } = options;

  useEffect(() => {
    let streamFailures = 0;
    let syncFailures = 0;
    const troubled = () =>
      onTrouble(Math.max(streamFailures, syncFailures) >= QUIET_FAILURES ? TROUBLE : null);

    const sync = retrying(catchUp, {
      onFailures: (n) => {
        syncFailures = n;
        troubled();
      },
      onRecovered: () => {
        syncFailures = 0;
        troubled();
      },
      onSessionEnded,
    });
    /** Догнать — только если лента уже стоит на курсоре. */
    const asked = () => {
      if (feedReady.current) sync.kick();
    };

    /**
     * ⚠️ ПОСЫЛКА ПРИМЕНЯЕТСЯ ТЕМ ЖЕ КУРСОРОМ, ЧТО И СТРАНИЦА ДОГОНА
     * (task-085). Номер сразу за курсором — применили и никуда не пошли;
     * разрыв — догон; «уже видели» — ничего. Курсор двигается на КАЖДОЙ
     * реплике, не только своего чата: иначе следующая в моём чате
     * выглядела бы разрывом.
     */
    const applyCarried = (line: Message, mentioned: string[]): Carried => {
      const what = carried(line.seq, cursor.current);
      if (what === "применить") {
        cursor.current = line.seq;
        accept([line]);
        // И панель — тем же событием, без запроса (task-092): непрерывность
        // уже доказана номером строкой выше.
        rooms.applied(line, mentioned);
        return what;
      }
      if (what === "догнать") asked();
      return what;
    };

    /**
     * Звонок без посылки: правка, удаление, закрепление, дела пространства.
     * За лентой идём только за своей (task-067); панель — всегда, её частоту
     * решает сам список.
     */
    const described = (changed: ChangeEvent) => {
      if (changed.conversation !== null && changed.conversation === openRef.current) asked();
      rooms.refresh();
    };

    let opened = 0;
    const close = openLiveStream("/v1/stream", {
      onEvent: (event) => {
        if (event.name !== "changed") return;
        const changed = changeOf(event.data);
        if (!changed.line) {
          described(changed);
          return;
        }
        if (applyCarried(changed.line, changed.mentions ?? []) === "догнать") rooms.refresh();
      },
      /**
       * ⚠️ ПОСЛЕ ПОДКЛЮЧЕНИЯ — ДОГОН: всё, что случилось, пока потока не было,
       * звонком уже не придёт (task-093, находка ②). На ПЕРВОМ подключении
       * панель не перечитывается — её только что загрузила сама страница;
       * на повторных — перечитывается, счётчики могли сдвинуться.
       */
      onOpen: () => {
        opened += 1;
        streamFailures = 0;
        troubled();
        asked();
        if (opened > 1) rooms.refresh();
      },
      onTrouble: (n) => {
        streamFailures = n;
        troubled();
      },
      onSessionEnded,
    });

    let safety: number | undefined;
    const armSafety = () => {
      safety = window.setTimeout(
        () => {
          if (document.visibilityState === "visible") asked();
          armSafety();
        },
        SAFETY_MIN_MS + Math.random() * SAFETY_SPREAD_MS,
      );
    };
    armSafety();

    /** Вернулись во вкладку — таймеры скрытой вкладки браузер замедлял. */
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      asked();
      rooms.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      close();
      sync.stop();
      window.clearTimeout(safety);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [
    catchUp,
    cursor,
    feedReady,
    accept,
    rooms.refresh,
    rooms.applied,
    openRef,
    onTrouble,
    onSessionEnded,
  ]);
}
