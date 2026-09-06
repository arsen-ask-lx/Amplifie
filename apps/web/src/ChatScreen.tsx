import type { Me } from "./api.js";
import { Composer } from "./Composer.js";
import { Feed } from "./Feed.js";
import { InvitePanel } from "./InvitePanel.js";
import { NewRoom } from "./NewRoom.js";
import { type Chat, useChat } from "./useChat.js";

/**
 * Главный экран: список разговоров слева, лента и поле ввода справа.
 *
 * Один `h1` — название пространства. Название канала ниже по уровню,
 * потому что оно и есть подраздел пространства, а не второй заголовок.
 * Один основной призыв к действию — «Отправить»; выход тихий.
 */
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
        В этом пространстве ещё нет каналов. Создание канала руками пока не сделано — новый канал
        появляется вместе с новым пространством.
      </p>
    );
  }

  return (
    <>
      <Feed
        messages={chat.messages}
        hasOlder={chat.hasOlder}
        onLoadOlder={() => void chat.loadOlder()}
        title={chat.current?.title}
        meId={meId}
      />
      <Composer onSend={chat.send} />
    </>
  );
}

export function ChatScreen({ me, onLeave }: { me: Me; onLeave: () => void }) {
  const chat = useChat();
  const threads = chat.conversations.filter((c) => c.parentId !== null);
  const channels = chat.conversations.filter((c) => c.parentId === null);

  return (
    <div className="workspace">
      <aside className="rail">
        <h1>{me.workspace.name}</h1>
        <p className="who">{me.participant.displayName}</p>

        <nav className="rooms" aria-label="Разговоры">
          {channels.map((channel) => (
            <div key={channel.id}>
              <button
                type="button"
                className={channel.id === chat.current?.id ? "room room-on" : "room"}
                aria-current={channel.id === chat.current?.id ? "page" : undefined}
                onClick={() => chat.select(channel.id)}
              >
                {channel.title}
              </button>
              {threads
                .filter((thread) => thread.parentId === channel.id)
                .map((thread) => (
                  <button
                    key={thread.id}
                    type="button"
                    className={
                      thread.id === chat.current?.id ? "room room-sub room-on" : "room room-sub"
                    }
                    aria-current={thread.id === chat.current?.id ? "page" : undefined}
                    onClick={() => chat.select(thread.id)}
                  >
                    {thread.title}
                  </button>
                ))}
            </div>
          ))}
        </nav>

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
          <h2>{chat.current?.title ?? "Канал"}</h2>
        </header>

        {chat.failure ? <p className="err-top">{chat.failure}</p> : null}
        <Room chat={chat} meId={me.participant.id} />
      </main>
    </div>
  );
}
