import type { SyncLine } from "./api.js";

/** Страница догона (`/v1/sync`). */
export interface SyncPage {
  messages: SyncLine[];
  /** Куда двигать курсор. */
  seq: number;
  hasMore: boolean;
}

/**
 * Догон до конца (Р-006): страницами, пока сервер говорит «есть ещё».
 *
 * ⚠️ БЕЗ ПРЕДЕЛА СТРАНИЦ. Прежде догон бросал работу после двадцати, и
 * вкладка, отставшая больше чем на тысячу изменений, хвост не получала
 * вовсе (task-027 №11). Страховка от вечного цикла другая и честная:
 * сервер не сдвинул курсор — дальше идти незачем.
 *
 * ⚠️ ОДИН ДОГОН ЗА РАЗ. Звонки приходят чаще, чем кончается догон; два
 * догона на одном курсоре тянули бы одни и те же страницы. Звонок во время
 * догона не запускает второй, а заказывает ещё один проход после текущего:
 * то, что пришло за время прохода, обязано быть забрано.
 */
export function catchUpWith(
  fetchPage: (after: number) => Promise<SyncPage>,
  cursor: { current: number },
  accept: (lines: SyncLine[]) => void,
): () => Promise<void> {
  let running: Promise<void> | null = null;
  let again = false;

  async function pass(): Promise<void> {
    for (;;) {
      const from = cursor.current;
      const page = await fetchPage(from);
      cursor.current = Math.max(cursor.current, page.seq);
      if (page.messages.length > 0) accept(page.messages);
      if (!page.hasMore || page.seq <= from) return;
    }
  }

  return () => {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          again = false;
          await pass();
        } while (again);
      } finally {
        running = null;
      }
    })();
    return running;
  };
}
