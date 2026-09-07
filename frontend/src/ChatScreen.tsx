import { useState } from "react";
import { AgentsScreen } from "./AgentsScreen.js";
import type { Me } from "./api.js";
import { api } from "./api.js";
import { Composer } from "./Composer.js";
import { Feed } from "./Feed.js";
import { Icon } from "./Icon.js";
import { Rail, type Section } from "./Rail.js";

/** Заголовок середины экрана. Разговор подписывается своим названием. */
const TITLES: Partial<Record<Section, string>> = {
  board: "Доска",
  deals: "Договорённости",
  agents: "Агенты",
};

import { type Chat, useChat } from "./useChat.js";
import { useWork, type Work } from "./useWork.js";
import { BoardScreen, type GoTo, WorkScreen } from "./WorkScreen.js";
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
      <AgentLine asking={chat.asking} failure={chat.agentFailure} />
      <Composer onSend={chat.send} />
    </>
  );
}

/**
 * Что происходит с агентом — строкой между лентой и полем ввода.
 *
 * ⚠️ НЕ РЕПЛИКОЙ В ЛЕНТЕ, и это принципиально. Сообщение «извините,
 * ошибка» от имени участника — ложь про то, кто говорил. Отказ живёт
 * рядом с разговором, а не внутри него, и исчезает со следующей отправкой.
 *
 * «Печатает…» мелькает и на сообщениях без обращения: решает сервер,
 * и без обращения он отвечает мгновенно. Это дешевле, чем держать
 * вторую копию правила «звали ли агента» здесь.
 */
function AgentLine({ asking, failure }: { asking: boolean; failure: string | null }) {
  if (asking) {
    return (
      <p className="agent-line" aria-live="polite">
        <span className="agent-dot">
          <Icon name="точка" size={12} />
        </span>
        Сводка печатает…
      </p>
    );
  }
  if (failure) {
    return (
      <p className="agent-line agent-line-bad" role="status">
        {failure}
      </p>
    );
  }
  return null;
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

/** Середина экрана целиком: разговор, работа или подключение модели. */
function Middle({
  section,
  chat,
  work,
  meId,
  onGoTo,
}: {
  section: Section;
  chat: Chat;
  work: Work;
  meId: string;
  onGoTo: GoTo;
}) {
  if (section === "agents") return <AgentsScreen />;
  if (section === "board") return <BoardScreen work={work} meId={meId} />;
  if (section === "deals") return <WorkScreen work={work} goTo={onGoTo} />;
  return <Room chat={chat} meId={meId} />;
}

export function ChatScreen({ me, onLeave }: { me: Me; onLeave: () => void }) {
  const chat = useChat();
  const work = useWork();
  const [section, setSection] = useState<Section>("talk");

  const pending = awaiting(work.agreements).length;

  return (
    <div className="workspace">
      <Rail
        me={me}
        chat={chat}
        section={section}
        onSwitch={setSection}
        pending={pending}
        onLeave={onLeave}
      />

      <main className="room-view">
        <header className="room-head">
          <h2>{TITLES[section] ?? chat.current?.title ?? "Канал"}</h2>
          {section === "talk" && chat.current ? (
            <Listen conversationId={chat.current.id} onHeard={work.reload} />
          ) : null}
        </header>

        {chat.failure ? <p className="err-top">{chat.failure}</p> : null}

        <Middle
          section={section}
          chat={chat}
          work={work}
          meId={me.participant.id}
          onGoTo={(conversationId, seq) => {
            setSection("talk");
            chat.openAt(conversationId, seq);
          }}
        />
      </main>
    </div>
  );
}
