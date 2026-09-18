import { MagnifyingGlass, Sidebar } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Me } from "../data/api.js";
import { useChat } from "../data/useChat.js";
import { ChatSearchBar } from "../screens/talk/ChatSearchBar.js";
import { Room } from "../screens/talk/Room.js";
import { SearchDialog } from "../screens/talk/SearchDialog.js";
import { Button } from "../shared/ui/button.js";
import { Rail } from "./Rail.js";
import { ThemePicker } from "./ThemePicker.js";

/** Главный экран: панель слева, разговор посередине. */

const PANEL_KEY = "amplifie.панель";

/**
 * Задвинута ли панель — помним между заходами.
 *
 * Тот, кто её задвинул, сделал это не на один экран: он работает в узком
 * окне или ему мешает список. Возвращать панель на место при каждой
 * перезагрузке значит спорить с человеком.
 */
function railWasOpen(): boolean {
  try {
    return localStorage.getItem(PANEL_KEY) !== "нет";
  } catch {
    // Хранилище закрыто настройками приватности. Панель — не то,
    // ради чего стоит падать.
    return true;
  }
}

export function ChatScreen({
  me,
  onLeave,
  onSessionEnded,
}: {
  me: Me;
  onLeave: () => void;
  /** Сервер перестал узнавать сессию — показывать вход решает приложение. */
  onSessionEnded: () => void;
}) {
  const chat = useChat(me, onSessionEnded);
  /**
   * Куда вести взгляд из полосы поиска. Ссылкой: `openAt` меняется
   * с каждым адресом, а следствие в полосе не должно из-за этого
   * перезапускаться и прыгать к тому же попаданию второй раз.
   */
  const openAtRef = useRef<((seq: number) => void) | null>(null);
  openAtRef.current = (seq) => chat.openAt(chat.panel.currentId ?? "", seq);

  const [railOpen, setRailOpen] = useState(railWasOpen);
  /** Открыто ли окно общего поиска по всем чатам (task-100, Ctrl+K). */
  const [searching, setSearching] = useState(false);
  const closeSearch = useCallback(() => setSearching(false), []);
  /** Открыта ли полоса поиска в этом чате (task-106, лупа и Ctrl+F). */
  const [findingHere, setFindingHere] = useState(false);
  const closeHere = useCallback(() => setFindingHere(false), []);
  const openHere = useCallback((seq: number) => {
    // Переход к попаданию — тем же адресом, что цитата: второго способа
    // доехать до реплики не заводим.
    openAtRef.current?.(seq);
  }, []);

  const toggleRail = useCallback(() => {
    setRailOpen((was) => {
      try {
        localStorage.setItem(PANEL_KEY, was ? "нет" : "да");
      } catch {
        // Не сохранилось — задвинутость продержится до перезагрузки.
      }
      return !was;
    });
  }, []);

  // Ctrl+B — тот же способ, что в Слаке, VS Code и Дискорде. Своего
  // сочетания мы не придумываем: горячая клавиша полезна ровно тем, что
  // её уже знают.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.code !== "KeyB") return;

      // ⚠️ В ПОЛЕ ВВОДА Ctrl+B — ЭТО ЖИРНЫЙ, А НЕ ПАНЕЛЬ. Оба сочетания
      // общеприняты, и оба мы взяли не выдумывая; столкнулись они только
      // когда поле стало форматированным. Победитель определяется местом:
      // курсор в тексте — значит человек пишет, а не ходит по разделам.
      // Найдено живым прогоном: панель уезжала при попытке сделать
      // слово жирным.
      const where = document.activeElement;
      const typing =
        where instanceof HTMLElement &&
        (where.isContentEditable || where.tagName === "INPUT" || where.tagName === "TEXTAREA");
      if (typing) return;

      event.preventDefault();
      toggleRail();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleRail]);

  /**
   * Ctrl+F — поиск в ОТКРЫТОМ чате (task-106), как в Telegram и в браузере.
   *
   * ⚠️ ОТБИРАЕМ У БРАУЗЕРА, И ЭТО ОСОЗНАННО. Родной поиск браузера ищет
   * по видимому куску ленты — а лента держит окно в 300 реплик, то есть
   * находит он «сколько повезло». Наш ищет по всему чату на сервере.
   */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.code !== "KeyF") return;
      event.preventDefault();
      setFindingHere(true);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /**
   * Ctrl+K — поиск, как в Слаке, Дискорде и VS Code (task-100).
   *
   * ⚠️ И ИЗ ПОЛЯ ВВОДА ТОЖЕ, в отличие от Ctrl+B. У редактора это сочетание
   * не занято (`fieldKeys.ts`), а искать хочется ровно тогда, когда пишешь.
   * `preventDefault` обязателен: иначе браузер уводит фокус в свою строку
   * поиска.
   */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.code !== "KeyK") return;
      event.preventDefault();
      setSearching(true);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    // ⚠️ ОБОЛОЧКА НЕ ПРОКРУЧИВАЕТСЯ НИЧЕМ (task-101), и нужны оба слова.
    // `relative`: подписи для чтения с экрана (`sr-only`) стоят абсолютно и без
    // опоры отсчитывались от корня — документ вырастал выше окна (замер на засеве:
    // 1087 px при 800), страницу крутило колесом. `overflow-clip`, а не `hidden`:
    // скрытое переполнение прокручивается из кода, и `scrollIntoView` перехода
    // уводил всю оболочку вместе с шапкой на 253 px (замер в `jump-calm.spec.ts`).
    <div className="relative flex h-dvh overflow-clip bg-bg text-ink">
      <Rail me={me} chat={chat} open={railOpen} onLeave={onLeave} />

      {/* ⚠️ `min-h-0` ЗДЕСЬ И НА ЛЕНТЕ — НЕ УКРАШЕНИЕ. У flex-ребёнка
          минимальная высота по умолчанию равна содержимому, поэтому лента
          не сжималась, колонка вырастала выше экрана, и поле ввода
          уезжало за нижний край: в чате не было видно, куда писать.
          Найдено живым прогоном — из кода это не читается. */}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-3">
          <button
            type="button"
            onClick={toggleRail}
            aria-label={railOpen ? "Задвинуть панель" : "Выдвинуть панель"}
            aria-expanded={railOpen}
            title={`${railOpen ? "Задвинуть" : "Выдвинуть"} панель (Ctrl+B вне поля ввода)`}
            className="grid size-9 shrink-0 place-items-center rounded bg-transparent text-muted transition-colors hover:bg-raised hover:text-ink"
          >
            <Sidebar className="size-[18px]" />
          </button>

          <h2 className="min-w-0 truncate text-head font-semibold text-ink">
            {chat.current?.title ?? "Канал"}
          </h2>

          <div className="ml-auto flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setFindingHere(true)}
              aria-label="Поиск в этом чате"
              title="Поиск в этом чате (Ctrl+F) · по всем чатам — Ctrl+K"
              className="grid size-9 shrink-0 place-items-center rounded bg-transparent text-muted transition-colors hover:bg-raised hover:text-ink"
            >
              <MagnifyingGlass className="size-[18px]" />
            </button>
            <ThemePicker />
          </div>
        </header>

        {findingHere && chat.panel.currentId ? (
          <ChatSearchBar room={chat.panel.currentId} onOpen={openHere} onClose={closeHere} />
        ) : null}

        {/* Две строки, а не одна (task-096): беда живых обновлений гаснет
            сама и не должна стирать отказ загрузки вместе с «Повторить». */}
        {chat.trouble ? (
          <p className="border-b border-line bg-panel px-5 py-2 text-aside text-danger">
            {chat.trouble}
          </p>
        ) : null}
        {chat.failure ? (
          <div className="flex items-center gap-3 border-b border-line bg-panel px-5 py-2 text-aside text-danger">
            <p>{chat.failure.text}</p>
            {chat.failure.retry ? (
              <Button variant="outline" size="xs" onClick={chat.failure.retry}>
                Повторить
              </Button>
            ) : null}
          </div>
        ) : null}

        <Room chat={chat} meId={me.participant.id} />
      </main>

      {searching ? <SearchDialog onOpen={chat.openAt} onClose={closeSearch} /> : null}
    </div>
  );
}
