import { useState } from "react";
import { useLocation } from "react-router";
import type { Me } from "../data/api.js";
import { api } from "../data/api.js";
import { type Chat, useChat } from "../data/useChat.js";
import { useWork, type Work } from "../data/useWork.js";
import { awaiting } from "../data/work.js";
import { AgentsScreen } from "../screens/agents/AgentsScreen.js";
import { Composer } from "../screens/talk/Composer.js";
import { Feed } from "../screens/talk/Feed.js";
import { BoardScreen, type GoTo, WorkScreen } from "../screens/WorkScreen.js";
import { Icon } from "../shared/Icon.js";
import { Button } from "../shared/ui/button.js";
import { Rail, type Section, sectionOf } from "./Rail.js";

/** Заголовок середины экрана. Разговор подписывается своим названием. */
const TITLES: Partial<Record<Section, string>> = {
  board: "Доска",
  deals: "Договорённости",
  agents: "Агенты",
};

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
  if (chat.loading) return <p className="p-8 text-center text-body text-muted">Загружаем…</p>;

  if (chat.conversations.length === 0) {
    return (
      <p className="p-8 text-center text-body text-muted">
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
      <p className="flex items-center gap-2 px-5 py-1 text-aside text-muted" aria-live="polite">
        <span className="animate-pulse text-accent">
          <Icon name="точка" size={12} />
        </span>
        Сводка печатает…
      </p>
    );
  }
  if (failure) {
    return (
      <p className="px-5 py-1 text-aside text-danger" role="status">
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
    <span className="flex shrink-0 items-center gap-2">
      <Button
        variant="outline"
        size="sm"
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
      </Button>
      {said ? <span className="text-aside text-muted">{said}</span> : null}
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
  // Раздел ВЫВОДИТСЯ из адреса, а не хранится рядом с ним (Р-019).
  // Хранить копию значило бы завести второй ответ на вопрос «где я».
  const section: Section = sectionOf(useLocation().pathname);

  const pending = awaiting(work.agreements).length;

  return (
    <div className="flex h-dvh bg-bg text-ink">
      <Rail me={me} chat={chat} section={section} pending={pending} onLeave={onLeave} />

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line px-5">
          <h2 className="truncate text-head font-semibold text-ink">
            {TITLES[section] ?? chat.current?.title ?? "Канал"}
          </h2>
          {section === "talk" && chat.current ? (
            <Listen conversationId={chat.current.id} onHeard={work.reload} />
          ) : null}
        </header>

        {chat.failure ? (
          <p className="border-b border-line bg-panel px-5 py-2 text-aside text-danger">
            {chat.failure}
          </p>
        ) : null}

        <Middle
          section={section}
          chat={chat}
          work={work}
          meId={me.participant.id}
          // Переход по цитате — это адрес: `/c/<разговор>/<номер>`.
          // Раздел меняется сам, потому что выводится из адреса.
          onGoTo={(conversationId, seq) => chat.openAt(conversationId, seq)}
        />
      </main>
    </div>
  );
}
