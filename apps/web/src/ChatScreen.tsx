import { useState } from "react";
import type { Me } from "./api.js";
import { api } from "./api.js";
import { Composer } from "./Composer.js";
import { Feed } from "./Feed.js";
import { InvitePanel } from "./InvitePanel.js";
import { NewRoom } from "./NewRoom.js";
import { RoomList } from "./RoomList.js";
import { type Chat, useChat } from "./useChat.js";
import { useWork } from "./useWork.js";
import { WorkScreen } from "./WorkScreen.js";
import { awaiting } from "./work.js";

/**
 * Главный экран: разговоры и работа.
 *
 * Два раздела, а не один: договорённости — не часть ленты, их читают
 * подряд и решают пачкой. Переключатель стоит НАД списком разговоров,
 * потому что список — навигация внутри раздела «Разговоры», а не общая.
 *
 * Разделов будет больше (документы, встречи), и это место для них уже
 * есть. Папок по-прежнему нет: порядок и поиск (Р-011).
 */

type Section = "talk" | "work";

/**
 * Середина экрана: загрузка, пустое пространство или разговор.
 *
 * Пространство без единого канала — не ошибка и не «пусто»: так выглядят
 * учётные записи, заведённые до того, как канал стал появляться при
 * регистрации. Экран обязан сказать это прямо, а не крутить загрузку.
 */
function Room({ chat, meId }: { chat: Chat; meId: string }) {
  if (chat.loading) return <p className="feed-empty">Загружаем…</p>;

  if (chat.conversations.length === 0) {
    return (
      <p className="feed-empty">
        В этом пространстве ещё нет каналов. Заведите первый — кнопка «+ Канал» слева.
      </p>
    );
  }

  return (
    <>
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
      />
      <Composer onSend={chat.send} />
    </>
  );
}

/**
 * Кнопка разбора: агент читает разговор и предлагает договорённости.
 *
 * ⚠️ Это временно КНОПКА, и она честно об этом говорит. Агент не слушает
 * сам, потому что «слушать всё» упирается в лимиты тарифа и месячный
 * бюджет — они не отвечены (О-1, О-2), а угадывать их дорого.
 */
function Listen({
  conversationId,
  onHeard,
}: {
  conversationId: string;
  onHeard: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);

  return (
    <span className="listen">
      <button
        type="button"
        className="quiet"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setSaid(null);
          try {
            const { proposed } = await api.listen(conversationId);
            // Ноль — это ответ, а не молчание: человек должен понимать
            // разницу между «агент ничего не нашёл» и «кнопка не сработала».
            setSaid(proposed > 0 ? `нашёл: ${proposed}` : "ничего не нашёл");
            await onHeard();
          } catch {
            setSaid("разбор не удался");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Слушает…" : "Разобрать"}
      </button>
      {said ? <span className="listen-said">{said}</span> : null}
    </span>
  );
}

/** Переключатель разделов. Счётчик — только у того, что ждёт человека. */
function Parts({
  section,
  onSwitch,
  pending,
}: {
  section: Section;
  onSwitch: (to: Section) => void;
  pending: number;
}) {
  return (
    <nav className="parts" aria-label="Разделы">
      <button
        type="button"
        className={section === "talk" ? "part part-on" : "part"}
        aria-current={section === "talk" ? "page" : undefined}
        onClick={() => onSwitch("talk")}
      >
        Разговоры
      </button>
      <button
        type="button"
        className={section === "work" ? "part part-on" : "part"}
        aria-current={section === "work" ? "page" : undefined}
        onClick={() => onSwitch("work")}
      >
        Работа
        {/* Счётчик только у ждущих решения: подтверждённое внимания не
            требует, а метка на нём учит эту метку не замечать. */}
        {pending > 0 ? <span className="part-count">{pending}</span> : null}
      </button>
    </nav>
  );
}

export function ChatScreen({ me, onLeave }: { me: Me; onLeave: () => void }) {
  const chat = useChat();
  const work = useWork();
  const [section, setSection] = useState<Section>("talk");

  const pending = awaiting(work.agreements).length;

  return (
    <div className="workspace">
      <aside className="rail">
        <h1>{me.workspace.name}</h1>
        <p className="who">{me.participant.displayName}</p>

        <Parts section={section} onSwitch={setSection} pending={pending} />

        <RoomList
          rooms={chat.conversations}
          currentId={chat.current?.id ?? null}
          onSelect={(id) => {
            // Выбор разговора — это и переход в раздел разговоров:
            // иначе клик по каналу из «Работы» выглядел бы как промах.
            setSection("talk");
            chat.select(id);
          }}
        />

        <div className="rail-actions">
          <NewRoom label="+ Канал" placeholder="Название канала" onCreate={chat.addChannel} />
          {chat.current ? (
            <NewRoom label="+ Ветка" placeholder="О чём ветка" onCreate={chat.addThread} />
          ) : null}
        </div>

        <div className="rail-foot">
          <InvitePanel />
          <button type="button" className="quiet rail-out" onClick={onLeave}>
            Выйти
          </button>
        </div>
      </aside>

      <main className="room-view">
        <header className="room-head">
          <h2>{section === "work" ? "Работа" : (chat.current?.title ?? "Канал")}</h2>
          {section === "talk" && chat.current ? (
            <Listen conversationId={chat.current.id} onHeard={work.reload} />
          ) : null}
        </header>

        {chat.failure ? <p className="err-top">{chat.failure}</p> : null}

        {section === "work" ? (
          <WorkScreen
            work={work}
            goTo={(conversationId, seq) => {
              setSection("talk");
              chat.openAt(conversationId, seq);
            }}
          />
        ) : (
          <Room chat={chat} meId={me.participant.id} />
        )}
      </main>
    </div>
  );
}
