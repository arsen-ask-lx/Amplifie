import { useCallback, useMemo, useRef, useState } from "react";
import { feedTroubleOf } from "../shared/trouble.js";
import { api, type Conversation, type Message, type Project } from "./api.js";
import { bumped, readApplied, type Who } from "./bumped.js";
import { coalesced } from "./coalesced.js";
import type { Address } from "./useAddress.js";
import { type PanelActions, usePanelActions } from "./usePanelActions.js";

/**
 * Список каналов и всё, что с ним делают.
 *
 * ⚠️ ВЫНЕСЕНО ИЗ `useChat` ПО ЗНАНИЮ, А НЕ ПО РАЗМЕРУ (Д-10, task-020).
 * Здесь «какие есть разговоры и как их заводят»; там — «что показывать
 * в открытом». Лента про список не спрашивает, список про ленту не знает,
 * и держать их вместе значило читать одно ради правки другого.
 *
 * ⚠️ СПИСОК ПЕРЕЧИТЫВАЕТСЯ, А НЕ ПРАВИТСЯ НА МЕСТЕ. Порядок по свежести
 * и связь веток с корнями сервер уже умеет собирать правильно; второе
 * такое место на клиенте разошлось бы с ним.
 *
 * ⚠️ НО ПЕРЕЧИТЫВАЕТСЯ НЕ ВСЁ ПРОСТРАНСТВО (Р-037, task-064). Панель
 * берёт сводный ответ — папки со счётчиками, первую порцию «Недавних»
 * и строку открытого чата, — а чаты папки только когда её раскрыли.
 * Прежний полный ответ вёз 5 241 строку и 1,4 МБ на каждое сообщение
 * в любом чате; сводный — 20 КБ (замер 11.09).
 */

/**
 * Сколько держим окно между перечитываниями по звонку.
 *
 * Три секунды — не наугад: столько же копятся отметки прочтения
 * (Р-029, взято у Телеграма). Человек не замечает такой задержки
 * в СОСЕДНЕМ чате — а в открытом ничего не задерживается вовсе:
 * реплика приезжает самим событием (task-085).
 *
 * Замерено до окна: 40 вкладок и 10 реплик подряд давали
 * 400 перечитываний панели и 1600 запросов к базе (`make panel-cost`).
 */
const PANEL_WINDOW_MS = 3000;

/**
 * Осознанно проглоченный отказ — и он ИМЕНОВАН.
 *
 * ⚠️ Пустой `catch` запрещён правилом проекта, и правильно: молча
 * съеденная ошибка — это ошибка, о которой никто не узнает. Здесь
 * проглатывание намеренное: не приехал список — человек читает то,
 * что уже на экране, и пугать его нечем. Имя делает решение видимым:
 * `catch(unshown)` читается как выбор, `catch(() => {})` — как недосмотр.
 */
function unshown(): void {
  // Тело намеренно пустое, и это сказано словами выше.
}

/** Папка панели со своими счётчиками: их считает сервер по видимым чатам. */
export interface PanelProject extends Project {
  unread: number;
  mentions: number;
}

export interface Rooms extends PanelActions {
  /** Загруженные строки: «Недавние», чаты раскрытых папок и открытый чат. */
  items: Conversation[];
  /** Проекты, в которых человеку виден хоть один чат (Р-032). */
  projects: PanelProject[];
  /** Первый ответ сервера пришёл: до него пустой список — «ещё не знаем», а не «нет ничего». */
  loaded: boolean;
  /** Перечитать. Возвращает то же, что положил в состояние. */
  reload: () => Promise<Conversation[]>;
  /**
   * Перечитать по звонку — но не чаще, чем имеет смысл (task-086).
   * Сразу, потом раз в окно. Отказы глотаются осознанно — см. `unshown`.
   *
   * ⚠️ ЗОВЁТСЯ ТОЛЬКО ТОГДА, КОГДА ПОСЫЛКУ ПРИМЕНИТЬ НЕ ВЫШЛО (task-092):
   * разрыв, правка, удаление, изменение пространства. Непрерывную реплику
   * панель применяет сама — см. `applied`.
   */
  refresh: () => void;

  /**
   * Реплика приехала событием и признана непрерывной — поправить строку
   * самим, не спрашивая сервер (task-092).
   *
   * ⚠️ ЗВАТЬ ТОЛЬКО ПОСЛЕ `carried() === "применить"`. Это условие —
   * единственное, что не даёт приращению копить ошибку: правило Телеграма
   * «номер идёт сразу за курсором, иначе разрыв».
   */
  applied: (line: Message, mentioned: string[]) => void;
  /**
   * Сервер подтвердил отметку «прочитано» и назвал остаток — поставить его
   * в строку (task-097). Число после отметки серверное, а не вычтенное
   * из окна ленты.
   */
  readApplied: (conversationId: string, seq: number, unread: number) => void;
  /** Раскрыли папку — привезти её первую порцию (10 чатов). */
  openProject: (projectId: string) => void;
  /** Есть ли в папке ещё чаты: по этому рисуется «Показать ещё». */
  moreIn: (projectId: string) => boolean;
  /** Следующая порция чатов папки — 25 штук. */
  loadMoreIn: (projectId: string) => Promise<void>;
  /** Есть ли ещё «Недавние» ниже загруженных. */
  moreRecent: boolean;
  /** Следующая порция «Недавних» — когда панель долистали до низа. */
  loadMoreRecent: () => Promise<void>;
}

/** Одна строка на один идентификатор: порции могут перекрыться на границе. */
function byId(rows: Conversation[]): Conversation[] {
  return [...new Map(rows.map((one) => [one.id, one])).values()];
}

/**
 * Загруженные порции одного списка: сами строки, курсоры этих порций
 * и курсор следующей.
 *
 * ⚠️ КУРСОРЫ ЗАПОМИНАЮТСЯ, ЧТОБЫ ПЕРЕЧИТАТЬ РОВНО ТО ЖЕ. Иначе после
 * звонка пришлось бы либо забыть догруженное — и «Показать ещё» схлопнулось
 * бы на каждое чужое сообщение, — либо оставить у этих строк вчерашние числа.
 */
interface Loaded {
  cursors: (string | null)[];
  items: Conversation[];
  next: string | null;
}

async function pagesOf(
  load: (cursor: string | null) => Promise<{ items: Conversation[]; next: string | null }>,
  cursors: (string | null)[],
): Promise<Loaded> {
  const pages = await Promise.all(cursors.map(load));
  return {
    cursors,
    items: byId(pages.flatMap((one) => one.items)),
    next: pages.at(-1)?.next ?? null,
  };
}

/**
 * @param me кто смотрит — нужно, чтобы считать непрочитанное приращением
 *   (task-092): свои реплики непрочитанными не бывают (Р-029).
 */
export function useRooms(where: Address, me: string): Rooms {
  const [projects, setProjects] = useState<PanelProject[]>([]);
  const [loaded, setLoaded] = useState(false);
  /** «Недавние»: первая порция приезжает со сводным ответом. */
  const [recent, setRecent] = useState<Loaded>({ cursors: [null], items: [], next: null });
  /** Чаты раскрытых папок — по одной записи на папку. */
  const [inProject, setInProject] = useState<Record<string, Loaded>>({});
  /** Строка открытого чата: он может лежать в свёрнутой папке. */
  const [open, setOpen] = useState<Conversation | null>(null);
  const { currentId, currentIdRef, navigate } = where;

  const items = useMemo(
    () =>
      byId([
        ...recent.items,
        ...Object.values(inProject).flatMap((one) => one.items),
        ...(open ? [open] : []),
      ]),
    [recent, inProject, open],
  );
  const itemsRef = useRef(items);
  itemsRef.current = items;
  // Порции папок — ссылкой: при сбое одной порции перечитывание берёт
  // прежние чаты этой папки, а не пустоту (task-096).
  const inProjectRef = useRef(inProject);
  inProjectRef.current = inProject;

  // Раскрытые папки — ссылкой: перечитывание зовётся из эффектов, которые
  // не должны пересоздаваться от каждой догруженной порции.
  const loadedProjects = useRef<Record<string, (string | null)[]>>({});
  const recentCursors = useRef<(string | null)[]>([null]);

  /** Порция папки не приехала: «нет такой» — папка выпадает; сбой — прежние чаты. */
  const folderAfterFailure = useCallback((projectId: string, error: unknown) => {
    if (feedTroubleOf(error) === "нет-такого") {
      delete loadedProjects.current[projectId];
      return null;
    }
    const previous = inProjectRef.current[projectId];
    return previous ? ([projectId, previous] as const) : null;
  }, []);

  const fetchNow = useCallback(async () => {
    const snapshot = await api.panel(currentIdRef.current);
    const [tail, folders] = await Promise.all([
      // Первая порция «Недавних» уже в сводном ответе; догруженные ниже
      // порции берём их же курсорами.
      recentCursors.current.length > 1
        ? pagesOf((cursor) => api.recent(cursor ?? ""), recentCursors.current.slice(1))
        : Promise.resolve<Loaded>({ cursors: [], items: [], next: snapshot.recent.next }),
      /**
       * ⚠️ ПАПКА, КОТОРОЙ БОЛЬШЕ НЕТ, НЕ ВАЛИТ ВСЮ ПАНЕЛЬ. Её убрали или
       * закрыли доступ — сервер честно отвечает «нет такой», и прежде этот
       * отказ ронял весь сводный запрос: панель замирала с папкой, которой
       * уже нет. Теперь папка просто выпадает из загруженных.
       *
       * ⚠️ НО ТОЛЬКО КОГДА ЕЁ НЕТ (task-096). Сбой сервера — не «нет такой»:
       * прежде от любого отказа чаты папки пропадали с экрана. Теперь при
       * сбое у папки остаются прежние чаты, а остальная панель применяется.
       */
      Promise.all(
        Object.entries(loadedProjects.current).map(async ([projectId, cursors]) => {
          try {
            const page = await pagesOf((cursor) => api.projectChats(projectId, cursor), cursors);
            return [projectId, page] as const;
          } catch (error) {
            return folderAfterFailure(projectId, error);
          }
        }),
      ),
    ]);

    setProjects(snapshot.projects);
    setOpen(snapshot.open);
    setRecent({
      cursors: recentCursors.current,
      items: byId([...snapshot.recent.items, ...tail.items]),
      next: tail.cursors.length > 0 ? tail.next : snapshot.recent.next,
    });
    const alive = folders.filter((one) => one !== null);
    setInProject(Object.fromEntries(alive));
    setLoaded(true);

    const fresh = byId([
      ...snapshot.recent.items,
      ...tail.items,
      ...alive.flatMap(([, page]) => page.items),
      ...(snapshot.open ? [snapshot.open] : []),
    ]);
    itemsRef.current = fresh;
    return fresh;
  }, [currentIdRef, folderAfterFailure]);

  /**
   * Перечитать — один запрос в пути и не больше одного в очереди (task-064).
   *
   * ⚠️ ЗВОНКИ СКЛЕИВАЮТСЯ, И БЕЗ ЭТОГО ПАНЕЛЬ ВИСЛА. Перечитывают трое:
   * звонок, догон чужой комнаты и смена разговора, — и на 5 000 чатах
   * каждое сообщение давало два полных ответа по 1,4 МБ. Замер 11.09:
   * пять сообщений — десять перечитываний. Теперь всё, что пришло, пока
   * ответ в пути, ждёт ОДНО следующее перечитывание: начатое до звонка
   * могло его не увидеть, а начатое после — увидит всё сразу.
   */
  const inFlight = useRef<Promise<Conversation[]> | null>(null);
  const queued = useRef<Promise<Conversation[]> | null>(null);
  const reload = useCallback((): Promise<Conversation[]> => {
    const start = () => {
      const running = fetchNow().finally(() => {
        if (inFlight.current === running) inFlight.current = null;
      });
      inFlight.current = running;
      return running;
    };
    const busy = inFlight.current;
    if (!busy) return start();
    queued.current ??= busy
      // Отказ предыдущего — не повод не спросить заново: его ждущий
      // получил свой отказ сам, очереди нужен свежий ответ.
      .catch(() => undefined)
      .then(() => {
        queued.current = null;
        return start();
      });
    return queued.current;
  }, [fetchNow]);

  /**
   * Перечитать по звонку: сразу, потом не чаще раза в окно.
   *
   * Отказ здесь глотается осознанно и именованно: не приехал список —
   * человек читает то, что уже на экране, и пугать его нечем.
   */
  const refresh = useMemo(
    () => coalesced(() => void reload().catch(unshown), PANEL_WINDOW_MS),
    [reload],
  );

  /**
   * Раскрыли папку — привезти её первую порцию.
   *
   * ⚠️ ОДИН РАЗ НА ПАПКУ: повторное раскрытие показывает уже привезённое,
   * а свежесть строк держит перечитывание по звонку.
   */
  const openProject = useCallback((projectId: string) => {
    if (loadedProjects.current[projectId]) return;
    loadedProjects.current[projectId] = [null];
    void api
      .projectChats(projectId)
      .then((page) => {
        setInProject((before) => ({
          ...before,
          [projectId]: { cursors: [null], items: page.items, next: page.next },
        }));
      })
      .catch(() => {
        // Не приехало — папка останется пустой, и человек раскроет её
        // ещё раз. Пугать его нечем: панель цела.
        delete loadedProjects.current[projectId];
      });
  }, []);

  const moreIn = useCallback(
    (projectId: string) => inProject[projectId]?.next !== null && projectId in inProject,
    [inProject],
  );

  const loadMoreIn = useCallback(
    async (projectId: string) => {
      const have = inProject[projectId];
      if (!have?.next) return;
      // Не приехало — кнопка «Показать ещё» остаётся, человек нажмёт снова.
      const page = await api.projectChats(projectId, have.next).catch(unshown);
      if (!page) return;
      loadedProjects.current[projectId] = [...have.cursors, have.next];
      setInProject((before) => ({
        ...before,
        [projectId]: {
          cursors: [...have.cursors, have.next as string],
          items: byId([...have.items, ...page.items]),
          next: page.next,
        },
      }));
    },
    [inProject],
  );

  const loadMoreRecent = useCallback(async () => {
    if (!recent.next) return;
    // Не приехало — край списка покажется снова, и попытка повторится.
    const page = await api.recent(recent.next).catch(unshown);
    if (!page) return;
    recentCursors.current = [...recent.cursors, recent.next];
    setRecent((before) => ({
      cursors: recentCursors.current,
      items: byId([...before.items, ...page.items]),
      next: page.next,
    }));
  }, [recent]);

  /**
   * Перечитать после удачной записи — не дожидаясь (task-096).
   *
   * ⚠️ ЗАПИСЬ ЖДЁТ ТОЛЬКО САМУ ЗАПИСЬ. Прежде правка ждала и перечитывания:
   * сервер записал, а перечитывание упало — и форма писала ошибку, хотя
   * проект уже заведён; второе нажатие заводило второй. Отказ перечитывания
   * здесь осознанный: следующее придёт по звонку, переходу или возврату
   * во вкладку.
   */
  const settle = useCallback(() => {
    void reload().catch(unshown);
  }, [reload]);

  const actions = usePanelActions({ settle, navigate, currentId, currentIdRef, itemsRef });

  /**
   * Правило строки — во все три хранилища разом.
   *
   * ⚠️ ТРИ ХРАНИЛИЩА, ОДНО ПРАВИЛО. Строка может лежать в «Недавних»,
   * в раскрытой папке или быть строкой открытого чата — панель грузится
   * порциями (Р-037). Не найдёт нигде — не сделает ничего, и это законно:
   * разговор просто не загружен.
   *
   * ⚠️ ССЫЛКА НЕ МЕНЯЕТСЯ, ЕСЛИ НИЧЕГО НЕ ИЗМЕНИЛОСЬ. Правило отдаёт тот же
   * массив — тогда `setState` не перерисовывает панель. На тысяче чужих
   * реплик это разница между живым экраном и мигающим.
   */
  const everywhere = useCallback((apply: (rows: Conversation[]) => Conversation[]) => {
    setRecent((before) => {
      const items = apply(before.items);
      return items === before.items ? before : { ...before, items };
    });
    setInProject((before) => {
      let touched = false;
      const after = Object.fromEntries(
        Object.entries(before).map(([projectId, page]) => {
          const items = apply(page.items);
          if (items === page.items) return [projectId, page];
          touched = true;
          return [projectId, { ...page, items }];
        }),
      );
      return touched ? after : before;
    });
    setOpen((before) => (before ? (apply([before])[0] ?? before) : before));
  }, []);

  /** Поправить строку самим по приехавшей реплике (task-092). */
  const applied = useCallback(
    (line: Message, mentioned: string[]) => {
      const who: Who = { me, openId: currentIdRef.current, mentioned };
      everywhere((rows) => bumped(rows, line, who));
    },
    [me, currentIdRef, everywhere],
  );

  /** Ответ на отметку «прочитано» — серверный остаток в строку (task-097). */
  const onRead = useCallback(
    (conversationId: string, seq: number, unread: number) => {
      everywhere((rows) => readApplied(rows, conversationId, seq, unread));
    },
    [everywhere],
  );

  return {
    items,
    projects,
    loaded,
    reload,
    refresh,
    applied,
    readApplied: onRead,
    openProject,
    moreIn,
    loadMoreIn,
    moreRecent: recent.next !== null,
    loadMoreRecent,
    ...actions,
  };
}
