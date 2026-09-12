import { At, CaretDown } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import type { Message } from "../../data/api.js";
import type { Focus } from "../../data/useChat.js";
import { dayFormat as dayOf } from "../../shared/when.js";
import type { Deeds, Picking } from "./Actions.js";
import { useFeedScroll } from "./feedScroll.js";
import { Group } from "./Group.js";
import { groupsOf, keyOf, type Row, rowsOf } from "./rows.js";

/**
 * Лента сообщений — по модели Телеграма (Р-008).
 *
 * Свои справа, чужие слева; подряд идущие от одного автора собираются
 * в группу и не повторяют имя; время живёт внутри пузыря; день отбивается
 * плашкой по центру.
 *
 * Пузырь здесь не украшение: он кодирует «кто сказал» без подписи под
 * каждой строкой. Именно поэтому у продолжений группы имени нет —
 * сторона и цвет уже ответили на этот вопрос.
 */

function Empty() {
  // Прижато книзу по той же причине, что и сама лента: приглашение
  // написать первое сообщение стоит рядом с полем, в которое пишут,
  // а не под заголовком в другом конце экрана.
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-end">
      <p className="p-8 text-center text-body text-muted">
        Здесь пока пусто. Напишите первое сообщение — с него начнётся канал.
      </p>
    </div>
  );
}

/**
 * Разрезать ленту чертой «Непрочитанные сообщения».
 *
 * ⚠️ ЧЕРТА РЕЖЕТ ГРУППУ, А НЕ ВСТАЁТ ПЕРЕД НЕЙ. Реплики одного автора
 * подряд склеиваются в группу; если черта пришлась на середину такой
 * группы, поставить её «перед группой» значило бы соврать на две-три
 * реплики — человек начал бы перечитывать уже прочитанное. Поэтому
 * строки делятся ПО НОМЕРУ, и каждая половина группируется сама.
 * У Телеграма черта тоже разрывает склейку.
 */
function splitAtLine(rows: Row[], boundary: number | null) {
  if (boundary === null) return { beforeLine: rows, afterLine: [] as Row[] };
  return {
    beforeLine: rows.filter((one) => one.message.seq <= boundary),
    afterLine: rows.filter((one) => one.message.seq > boundary),
  };
}

/**
 * Склейки реплик с разделителями дней.
 *
 * ⚠️ ВЫНЕСЕНО ИЗ `Feed`, КОГДА ЧЕРТА «НЕПРОЧИТАННЫЕ» РАЗРЕЗАЛА ЛЕНТУ
 * НАДВОЕ. До неё это была одна выкладка внутри разметки; с чертой их
 * стало две одинаковых, а два одинаковых куска разметки — это тот самый
 * повтор, который расходится при первой же правке одного из них.
 */
function Groups({
  rows,
  deeds,
  onGo,
  picking,
}: {
  rows: Row[];
  deeds: Deeds;
  onGo: (seq: number) => void;
  picking: Picking | null;
}) {
  return groupsOf(rows).map((group) => (
    <div key={group[0] ? keyOf(group[0].message) : "пусто"}>
      {group[0]?.newDay ? (
        <p className="my-4 text-center">
          <span className="rounded-pill border border-line bg-card px-3 py-1 text-mark text-muted">
            {dayOf.format(new Date(group[0].message.createdAt))}
          </span>
        </p>
      ) : null}
      <Group rows={group} deeds={deeds} onGo={onGo} picking={picking} />
    </div>
  ));
}

/**
 * Угловые кнопки ленты: «к упоминанию» и «в конец».
 *
 * ⚠️ ВЫНЕСЕНЫ ИЗ ЛЕНТЫ ЦЕЛИКОМ, А НЕ ПОРОЗНЬ. Их две, и главное про них —
 * не что делает каждая, а как они стоят ДРУГ НАД ДРУГОМ: кнопка зова
 * съезжает на место нижней, когда та скрыта. Это одно знание, и жить
 * оно должно в одном месте — иначе разъедется на первой же правке
 * отступов.
 */
function Corners({
  atBottom,
  toBottom,
  mentions,
  onGoToMention,
}: {
  atBottom: boolean;
  toBottom: () => void;
  mentions: number;
  onGoToMention: () => void;
}) {
  return (
    <>
      {/* ⚠️ КНОПКА УПОМИНАНИЙ ВЫШЕ КНОПКИ «ВНИЗ», И ЭТО ПОРЯДОК ТЕЛЕГРАМА:
          у них угловые кнопки складываются стопкой, а зов важнее конца
          ленты — к нему идут осознанно, а вниз просто возвращаются. */}
      {mentions > 0 ? (
        <button
          type="button"
          onClick={onGoToMention}
          aria-label={`Перейти к упоминанию, их ${mentions}`}
          title="Перейти к упоминанию"
          className={[
            "absolute right-4 grid size-10 place-items-center rounded-pill border border-line",
            "bg-card text-accent-ink shadow-float transition-colors hover:text-ink",
            // Над кнопкой «вниз», когда та видна, и на её месте, когда нет.
            atBottom ? "bottom-4" : "bottom-16",
          ].join(" ")}
        >
          <At className="size-5" />
        </button>
      ) : null}

      {/* ⚠️ ПОЯВЛЯЕТСЯ, ТОЛЬКО КОГДА ЛЕНТА НЕ В КОНЦЕ. Кнопка «вниз», видная
          всегда, — это кнопка, которая в девяти случаях из десяти ничего
          не делает; такие перестают замечать. Так же у Телеграма. */}
      {atBottom ? null : (
        <button
          type="button"
          onClick={toBottom}
          aria-label="В конец ленты"
          title="В конец ленты"
          className="absolute right-4 bottom-4 grid size-10 place-items-center rounded-pill border border-line bg-card text-muted shadow-float transition-colors hover:text-ink"
        >
          <CaretDown className="size-5" />
        </button>
      )}
    </>
  );
}

export function Feed({
  messages,
  hasOlder,
  onLoadOlder,
  title,
  meId,
  focus,
  deeds,
  onGo,
  picking,
  boundary,
  mentions,
  onGoToMention,
  onFollow,
}: {
  messages: Message[];
  hasOlder: boolean;
  onLoadOlder: () => void | Promise<void>;
  title: string | undefined;
  meId: string;
  /** Реплика, из которой пришли по цитате. */
  focus: Focus | null;
  /** Что реплика умеет: ответить, переслать, закрепить, изменить, удалить. */
  deeds: Deeds;
  /** Перейти к реплике по её номеру — цитата и полоска ведут сюда же. */
  onGo: (seq: number) => void;
  /** Идёт выделение. `null` — обычный режим. */
  picking: Picking | null;
  /**
   * Перед какой репликой стоит черта «Непрочитанные сообщения».
   * `null` — черты нет. Замирает при открытии разговора (Р-029).
   */
  boundary: number | null;
  /** Сколько раз тут позвали тебя и ты этого не видел (Р-031). */
  mentions: number;
  /** Увести к самому раннему неувиденному зову. */
  onGoToMention: () => void;
  /**
   * Сказать наружу, внизу ли человек. По этому ответу лента решает,
   * можно ли вытеснять старое сверху (Р-023): у листающего назад —
   * нельзя, он читает ровно то, что мы бы выбросили.
   */
  onFollow: (yes: boolean) => void;
}) {
  const newest = messages.at(-1)?.seq ?? 0;
  const newestMine = messages.at(-1)?.author.id === meId;

  // Как лента ЕДЕТ — отдельным вопросом и отдельным файлом. Здесь только
  // то, как она ВЫГЛЯДИТ.
  const { box, atBottom, onScroll, toBottom } = useFeedScroll({
    newest,
    newestMine,
    count: messages.length,
    hasOlder,
    onLoadOlder,
    focus,
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: важен сам факт смены
  useEffect(() => onFollow(atBottom), [atBottom]);

  // Что было на экране при первом показе — не «новое». Иначе при открытии
  // канала оживает вся лента разом, а это ровно та примета: движение
  // на каждом блоке вместо движения там, где что-то изменилось.
  const wasThereAtFirst = useRef<number | null>(null);
  if (wasThereAtFirst.current === null && messages.length > 0) {
    wasThereAtFirst.current = newest;
  }

  if (messages.length === 0) return <Empty />;

  const rows = rowsOf(messages, meId, wasThereAtFirst.current);

  const { beforeLine, afterLine } = splitAtLine(rows, boundary);

  return (
    // Обёртка нужна кнопке «вниз»: она висит НАД лентой и не должна
    // ни ездить вместе с ней, ни попадать в поток сообщений.
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* role="log" — новые сообщения читаются вслух программой чтения экрана. */}
      <div
        /* ⚠️ ЛЕНТА ПРИЖАТА КНИЗУ, А НЕ КВЕРХУ. Пока сообщений мало, они
           обязаны лежать НАД полем ввода, а не висеть под заголовком:
           разговор растёт снизу вверх, и в Телеграме, Слаке и Дискорде
           это так у всех (замечание владельца с экрана).
           Приём: сама область прокрутки — колонка, а содержимое отжато
           вниз внешним отступом `mt-auto`. Прокрутка при этом работает
           как работала: когда содержимое перерастает высоту, отжимать
           уже нечего, и `mt-auto` перестаёт что-либо значить сам. */
        className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-3"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        ref={box}
        onScroll={onScroll}
      >
        <div className="mt-auto">
          {hasOlder ? (
            <p className="mb-3 text-center text-aside text-muted" aria-live="polite">
              Загружаем более раннее…
            </p>
          ) : (
            <p className="mb-4 text-center text-aside text-muted">
              {title ? `Начало канала «${title}»` : "Начало канала"}
            </p>
          )}

          <Groups rows={beforeLine} deeds={deeds} onGo={onGo} picking={picking} />

          {/* ⚠️ НАДПИСЬ БЕЗ ЧИСЛА — как `lng_unread_bar_some` у них.
              Сколько именно, человек уже прочёл у канала в панели;
              повторять число здесь значит сказать одно и то же дважды. */}
          {afterLine.length > 0 ? (
            <p className="my-3 flex items-center gap-3 text-mark text-muted">
              <span className="h-px flex-1 bg-line" />
              Непрочитанные сообщения
              <span className="h-px flex-1 bg-line" />
            </p>
          ) : null}

          <Groups rows={afterLine} deeds={deeds} onGo={onGo} picking={picking} />
        </div>
      </div>

      <Corners
        atBottom={atBottom}
        toBottom={toBottom}
        mentions={mentions}
        onGoToMention={onGoToMention}
      />
    </div>
  );
}
