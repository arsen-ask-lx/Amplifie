import { useState } from "react";
import { api, type Message } from "../../data/api.js";
import type { Chat } from "../../data/useChat.js";
import { copyAndTell } from "../../shared/clipboard.js";
import { COPIED } from "../../shared/toast.js";
import { ConfirmDialog } from "../../shared/ui/ask-dialog.js";
import { Composer } from "./Composer.js";
import { Feed } from "./Feed.js";
import { ForwardPicker } from "./ForwardPicker.js";
import { PinnedBar } from "./PinnedBar.js";
import { messagesWord, SelectionBar } from "./SelectionBar.js";

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

  /** Что удаляем — ждёт ответа на вопрос. `null` — вопроса нет. */
  const [removing, setRemoving] = useState<Message[] | null>(null);

  const chosen = picked ? chat.messages.filter((one) => picked.has(one.id)) : [];

  // Своё — всегда; чужое — если здесь модерирую (Р-035). Решает сервер,
  // а это честный вид того же правила: меню не обещает недоступного.
  const canRemove = removableBy(meId, chat.current?.moderator === true);

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

  /**
   * К самому раннему неувиденному зову.
   *
   * ⚠️ НОМЕР СПРАШИВАЕМ У СЕРВЕРА, А НЕ ИЩЕМ В ЛЕНТЕ. Клиент держит окно
   * в 300 реплик (Р-023), и зов может лежать за его краем — тогда поиск
   * по загруженному нашёл бы не первый пропущенный, а первый попавшийся.
   */
  const jumpToMention = async () => {
    const current = chat.current;
    if (!current) return;
    const { seq } = await api.nearestMention(current.id);
    if (seq !== null) go(seq);
  };

  const deeds = {
    onReply: (message: Message) => chat.reply(message),
    onForward: (message: Message) => setForwarding(message),
    onPin: (message: Message, pinned: boolean) => void chat.pin(message.id, pinned),
    onEdit: (message: Message) => setEditing(message),
    onRemove: (message: Message) => setRemoving([message]),
    canRemove,
    onSelect: (message: Message) => setPicked(new Set([message.id])),
  };

  if (chat.conversations.length === 0) return <NoChats loading={chat.loading} />;

  // Какой разговор открыт — из адреса (Р-019), а не из строки панели.
  const openKey = chat.panel.currentId;

  return (
    <>
      <PinnedBar
        pinned={chat.pinned}
        onGo={go}
        onUnpin={(message) => void chat.pin(message.id, false)}
      />

      {feedPending(chat) ? (
        <div className="min-h-0 flex-1" />
      ) : (
        <Feed
          // Смена разговора пересоздаёт ленту: «прыгнуть в конец до отрисовки»
          // работает как «при открытии». ⚠️ Ключ из адреса (task-101): строка
          // панели у чата из поиска приезжала позже, и лента создавалась дважды.
          key={openKey}
          messages={chat.messages}
          mentions={chat.current ? chat.panel.mentionsOf(chat.current.id) : 0}
          onGoToMention={() => void jumpToMention()}
          hasOlder={chat.hasOlder}
          onLoadOlder={() => chat.loadOlder()}
          hasNewer={chat.hasNewer}
          onLoadNewer={() => chat.loadNewer()}
          onToLatest={chat.toLatest}
          title={chat.current?.title}
          meId={meId}
          focus={chat.focus}
          deeds={deeds}
          onGo={go}
          picking={picked ? { chosen: picked, toggle } : null}
          boundary={chat.boundary}
          onFollow={chat.follow}
          onSeen={chat.seen}
        />
      )}
      <AgentFailure failure={chat.agentFailure} />

      {picked ? (
        <SelectionBar
          chosen={chosen}
          canRemove={canRemove}
          onCancel={() => setPicked(null)}
          // Копируется одним куском с именами: так выделенное и вставляется
          // потом — в письмо или в задачу, а не по одной строке.
          onCopy={() => {
            void copyAndTell(
              chosen.map((one) => `${one.author.name}: ${one.body}`).join("\n"),
              COPIED.text,
            );
            setPicked(null);
          }}
          onForward={() => {
            const first = chosen[0];
            if (first) setForwarding(first);
          }}
          onRemove={() => setRemoving(chosen)}
        />
      ) : null}

      <Composer
        // ⚠️ Ключ по разговору (task-101): поле больше не снимается на загрузку,
        // и без ключа набранное в одном чате уехало бы в другой. Ключ отличен
        // от ключа ленты: одинаковые ключи соседей React путает.
        key={`поле-${openKey}`}
        conversationId={chat.current?.id ?? null}
        onSend={chat.send}
        replying={chat.replying}
        onCancelReply={() => chat.reply(null)}
        editing={editing}
        onCancelEdit={() => setEditing(null)}
        onEditLast={() => startEditing(lastOwnSent(chat.messages, meId), setEditing)}
        onSaveEdit={async (body) => {
          if (!editing) return;
          await chat.edit(editing.id, body);
          setEditing(null);
        }}
      />

      <RemoveConfirm
        messages={removing}
        remove={chat.remove}
        onClose={() => setRemoving(null)}
        onRemoved={() => setPicked(null)}
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
 * Лента пуста и грузится — на её месте пустое место без слов (task-101).
 * Прежде «Загружаем…» вставало вместо всей середины, и поле ввода снималось
 * на каждое открытие чата (владелец, показ 17.09).
 */
function feedPending(chat: Chat): boolean {
  return chat.loading && chat.messages.length === 0;
}

/**
 * Чатов нет. До первого ответа панели это «ещё не знаем» — пусто и без слов;
 * после — пространство без единого чата, и экран говорит это прямо.
 */
function NoChats({ loading }: { loading: boolean }) {
  if (loading) return null;
  return (
    <p className="p-8 text-center text-body text-muted">
      В этом пространстве ещё нет чатов. Заведите первый — «Новый чат» слева.
    </p>
  );
}

/**
 * Последнее своё отправленное — для `↑`, как в Telegram Desktop.
 * Неотправленное носит дробный номер: править на сервере нечего.
 */
function lastOwnSent(messages: Message[], meId: string): Message | undefined {
  return messages.findLast((one) => one.author.id === meId && Number.isInteger(one.seq));
}

/** Открыть правку, если есть что править. `false` — стрелка остаётся стрелкой. */
function startEditing(message: Message | undefined, edit: (message: Message) => void): boolean {
  if (!message) return false;
  edit(message);
  return true;
}

/** Можно ли удалить: своё — всегда, чужое — если модерирую здесь (Р-035). */
function removableBy(meId: string, moderator: boolean) {
  return (message: Message) => moderator || message.author.id === meId;
}

/** Вопрос перед удалением — как в Телеграме: удалённое исчезает у всех. */
function RemoveConfirm({
  messages,
  remove,
  onClose,
  onRemoved,
}: {
  /** Что удаляем. `null` — вопроса нет, окно не показывается. */
  messages: Message[] | null;
  remove: (id: string) => Promise<void>;
  onClose: () => void;
  onRemoved: () => void;
}) {
  if (!messages) return null;
  const count = messages.length;
  const one = count === 1;
  const confirm = async () => {
    onClose();
    // Последовательно, а не пачкой: ручки «удалить много» на сервере
    // нет. Первая же неудача остановит и скажет.
    for (const message of messages) await remove(message.id);
    onRemoved();
  };
  return (
    <ConfirmDialog
      title={one ? "Удалить сообщение?" : `Удалить ${count} ${messagesWord(count)}?`}
      description={one ? "Оно исчезнет у всех в чате." : "Они исчезнут у всех в чате."}
      confirmLabel="Удалить"
      onCancel={onClose}
      onConfirm={() => void confirm()}
    />
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
