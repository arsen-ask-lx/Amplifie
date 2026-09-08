import { useState } from "react";
import type { Message } from "../../data/api.js";
import type { Chat } from "../../data/useChat.js";
import { copy } from "../../shared/clipboard.js";
import { Composer } from "./Composer.js";
import { Feed } from "./Feed.js";
import { ForwardPicker } from "./ForwardPicker.js";
import { PinnedBar } from "./PinnedBar.js";
import { SelectionBar } from "./SelectionBar.js";

/**
 * Разговор целиком: полоска закреплённого, лента, полоска выделения,
 * поле ввода и выбор канала для пересылки.
 *
 * ⚠️ ВЫНЕСЕН ИЗ `ChatScreen`, КОГДА ТОТ ПЕРЕВАЛИЛ ЗА ПРЕДЕЛ РАЗМЕРА.
 * Шов не выдуман под предел: `ChatScreen` отвечает на вопрос «какой
 * раздел показывать и как устроен экран целиком», а это — на вопрос
 * «как устроен разговор». Второй вопрос вырос за месяц вчетверо
 * и оброс собственными состояниями: пересылка, правка, выделение.
 */

/**
 * Середина экрана: загрузка, пустое пространство или разговор.
 *
 * Пространство без единого канала — не ошибка и не «пусто»: так выглядят
 * учётные записи, заведённые до того, как канал стал появляться при
 * регистрации. Экран обязан сказать это прямо, а не крутить загрузку.
 */
export function Room({ chat, meId }: { chat: Chat; meId: string }) {
  /** Кого пересылаем. `null` — выбор канала закрыт. */
  const [forwarding, setForwarding] = useState<Message | null>(null);
  /** Какую реплику правим. Правка идёт в том же поле ввода, что и отправка. */
  const [editing, setEditing] = useState<Message | null>(null);
  /**
   * Что выделено. `null` — режима выделения нет вовсе.
   *
   * Пустое множество и `null` — разные состояния: в первом человек вошёл
   * в режим и снял все галочки, во втором режима нет. Слив их, мы бы
   * закрывали режим на каждое снятие последней галочки.
   */
  const [picked, setPicked] = useState<Set<string> | null>(null);

  const chosen = picked ? chat.messages.filter((one) => picked.has(one.id)) : [];

  function toggle(message: Message) {
    setPicked((was) => {
      const next = new Set(was ?? []);
      if (next.has(message.id)) next.delete(message.id);
      else next.add(message.id);
      return next;
    });
  }

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
    onSelect: (message: Message) => setPicked(new Set([message.id])),
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
        onLoadOlder={() => chat.loadOlder()}
        title={chat.current?.title}
        meId={meId}
        focus={chat.focus}
        deeds={deeds}
        onGo={go}
        picking={picked ? { chosen: picked, toggle } : null}
      />
      <AgentFailure failure={chat.agentFailure} />

      {picked ? (
        <SelectionBar
          chosen={chosen}
          meId={meId}
          onCancel={() => setPicked(null)}
          // Копируется одним куском с именами: так выделенное и вставляется
          // потом — в письмо или в задачу, а не по одной строке.
          onCopy={() => {
            void copy(chosen.map((one) => `${one.author.name}: ${one.body}`).join("\n"));
            setPicked(null);
          }}
          onForward={() => {
            const first = chosen[0];
            if (first) setForwarding(first);
          }}
          onRemove={() => {
            // Последовательно, а не пачкой: ручки «удалить много» на сервере
            // нет, и выдумывать её на клиенте циклом с молчаливыми отказами
            // нельзя. Первая же неудача остановит и скажет.
            void (async () => {
              for (const one of chosen) await chat.remove(one.id);
              setPicked(null);
            })();
          }}
        />
      ) : null}

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
