import { PanelLeft } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router";
import type { Me, Message } from "../data/api.js";
import { type Chat, useChat } from "../data/useChat.js";
import { useWork, type Work } from "../data/useWork.js";
import { AgentsScreen } from "../screens/agents/AgentsScreen.js";
import { BoardScreen } from "../screens/BoardScreen.js";
import { Composer } from "../screens/talk/Composer.js";
import { Feed } from "../screens/talk/Feed.js";
import { ForwardPicker } from "../screens/talk/ForwardPicker.js";
import { PinnedBar } from "../screens/talk/PinnedBar.js";
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

/**
 * Середина экрана: загрузка, пустое пространство или разговор.
 *
 * Пространство без единого канала — не ошибка и не «пусто»: так выглядят
 * учётные записи, заведённые до того, как канал стал появляться при
 * регистрации. Экран обязан сказать это прямо, а не крутить загрузку.
 */
function Room({ chat, meId }: { chat: Chat; meId: string }) {
  /** Кого пересылаем. `null` — выбор канала закрыт. */
  const [forwarding, setForwarding] = useState<Message | null>(null);
  /** Какую реплику правим. Правка идёт в том же поле ввода, что и отправка. */
  const [editing, setEditing] = useState<Message | null>(null);

  // Переход к реплике — тем же адресом, что и переход по ссылке на неё.
  // Второго способа доехать до сообщения заводить нельзя: они разойдутся.
  const go = (seq: number) => {
    if (chat.current) chat.openAt(chat.current.id, seq);
  };

  const deeds = {
    onReply: (message: Message) => chat.reply(message),
    onForward: (message: Message) => setForwarding(message),
    onPin: (message: Message, pinned: boolean) => void chat.pin(message.id, pinned),
    onEdit: (message: Message) => setEditing(message),
    onRemove: (message: Message) => void chat.remove(message.id),
  };

  // «Загружаем…» только когда показать НЕЧЕГО. Если лента уже на экране,
  // подгрузка идёт молча: подменять готовое содержимое надписью — это
  // мигание на ровном месте.
  if (chat.loading && chat.messages.length === 0) {
    return <p className="p-8 text-center text-body text-muted">Загружаем…</p>;
  }

  if (chat.conversations.length === 0) {
    return (
      <p className="p-8 text-center text-body text-muted">
        В этом пространстве ещё нет каналов. Заведите первый — плюс в заголовке «Каналы» слева.
      </p>
    );
  }

  return (
    <>
      <PinnedBar
        pinned={chat.pinned}
        onGo={go}
        onUnpin={(message) => void chat.pin(message.id, false)}
      />

      <Feed
        // Смена разговора пересоздаёт ленту: тогда «прыгнуть в конец
        // до отрисовки» работает как «при открытии», без лишнего состояния.
        key={chat.current?.id ?? "пусто"}
        messages={chat.messages}
        hasOlder={chat.hasOlder}
        onLoadOlder={() => void chat.loadOlder()}
        title={chat.current?.title}
        meId={meId}
        focus={chat.focus}
        deeds={deeds}
        onGo={go}
      />
      <AgentFailure failure={chat.agentFailure} />
      <Composer
        onSend={chat.send}
        replying={chat.replying}
        onCancelReply={() => chat.reply(null)}
        editing={editing}
        onCancelEdit={() => setEditing(null)}
        onSaveEdit={async (body) => {
          if (!editing) return;
          await chat.edit(editing.id, body);
          setEditing(null);
        }}
      />

      {forwarding ? (
        <ForwardPicker
          message={forwarding}
          rooms={chat.conversations}
          onClose={() => setForwarding(null)}
          onPick={(id) => {
            void chat.forward(forwarding, id);
            setForwarding(null);
          }}
        />
      ) : null}
    </>
  );
}

/**
 * Почему агент не ответил — строкой между лентой и полем ввода.
 *
 * ⚠️ НЕ РЕПЛИКОЙ В ЛЕНТЕ, и это принципиально. Сообщение «извините,
 * ошибка» от имени участника — ложь про то, кто говорил. Отказ живёт
 * рядом с разговором, а не внутри него, и исчезает со следующей отправкой.
 *
 * ⚠️ «ПЕЧАТАЕТ…» УБРАНО ВЛАДЕЛЬЦЕМ. Строка загоралась на КАЖДОЙ отправке,
 * а не только когда агента звали: решает сервер, и без обращения он
 * отвечает мгновенно — то есть почти всегда это было мелькание ни о чём.
 * Вместе со строкой ушло и состояние `asking`: держать признак, который
 * ничего не рисует, значит однажды нарисовать им что-нибудь не то.
 */
function AgentFailure({ failure }: { failure: string | null }) {
  if (!failure) return null;
  return (
    <p className="px-5 py-1 text-aside text-danger" role="status">
      {failure}
    </p>
  );
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
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "b") return;
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
            title={`${railOpen ? "Задвинуть" : "Выдвинуть"} панель (Ctrl+B)`}
            className="grid size-9 shrink-0 place-items-center rounded bg-transparent text-muted transition-colors hover:bg-raised hover:text-ink"
          >
            <PanelLeft className="size-[18px]" />
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
