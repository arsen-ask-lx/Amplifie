import { Sidebar } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router";
import type { Me } from "../data/api.js";
import { type Chat, useChat } from "../data/useChat.js";
import { useWork, type Work } from "../data/useWork.js";
import { AgentsScreen } from "../screens/agents/AgentsScreen.js";
import { BoardScreen } from "../screens/BoardScreen.js";
import { Room } from "../screens/talk/Room.js";
import { Rail, type Section, sectionOf } from "./Rail.js";

/** Заголовок середины экрана. Разговор подписывается своим названием. */
const TITLES: Partial<Record<Section, string>> = {
  board: "Доска",
  agents: "Агенты",
};

/**
 * Главный экран: чат и работа.
 *
 * Разделов будет больше (документы, встречи), и это место для них уже
 * есть. Папок по-прежнему нет: порядок и поиск (Р-011).
 */

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

/** Середина экрана целиком: разговор, работа или подключение модели. */
function Middle({
  section,
  chat,
  work,
  meId,
}: {
  section: Section;
  chat: Chat;
  work: Work;
  meId: string;
}) {
  if (section === "agents") return <AgentsScreen />;
  if (section === "board") return <BoardScreen work={work} meId={meId} />;
  return <Room chat={chat} meId={meId} />;
}

export function ChatScreen({ me, onLeave }: { me: Me; onLeave: () => void }) {
  const chat = useChat(me);
  const work = useWork();
  // Раздел ВЫВОДИТСЯ из адреса, а не хранится рядом с ним (Р-019).
  // Хранить копию значило бы завести второй ответ на вопрос «где я».
  const section: Section = sectionOf(useLocation().pathname);

  const [railOpen, setRailOpen] = useState(railWasOpen);

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

  return (
    <div className="flex h-dvh overflow-hidden bg-bg text-ink">
      <Rail me={me} chat={chat} section={section} open={railOpen} onLeave={onLeave} />

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
            {TITLES[section] ?? chat.current?.title ?? "Канал"}
          </h2>
        </header>

        {chat.failure ? (
          <p className="border-b border-line bg-panel px-5 py-2 text-aside text-danger">
            {chat.failure}
          </p>
        ) : null}

        <Middle section={section} chat={chat} work={work} meId={me.participant.id} />
      </main>
    </div>
  );
}
