import {
  AlertCircle,
  Check,
  Clock3,
  Copy,
  CornerUpLeft,
  Forward,
  Link2,
  Pencil,
  Pin,
  PinOff,
  SquareCheck,
  Trash2,
} from "lucide-react";
import type { Message } from "../../data/api.js";
import type { Local } from "../../data/useChat.js";
import { copy } from "../../shared/clipboard.js";
import { RichText } from "../../shared/RichText.js";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../../shared/ui/context-menu.js";
import { часы } from "../../shared/when.js";
import { Quote } from "./Quote.js";

/**
 * Реплика в ленте и всё, что решает, как она выглядит.
 *
 * ВЫНЕСЕНО ИЗ ЛЕНТЫ: у той осталось одно дело — прокрутка, догон и переход
 * по цитате, а это отдельная и непростая механика. Гейт размера файла был
 * прав: 312 строк означали, что в один файл дописывают всё, что рядом.
 *
 * ⚠️ ОДИН СТОЛБЕЦ, А НЕ ДВЕ СТОРОНЫ (владелец, 2026-09-08). Было как
 * в Телеграме НА ТЕЛЕФОНЕ: свои справа, чужие слева. Стало как в Телеграме
 * НА ДЕСКТОПЕ: все реплики в одном центрированном столбце, свои отличаются
 * цветом пузыря. Проверено по их обсуждениям — двусторонняя раскладка
 * у них до сих пор в просьбах пользователей, а не в программе.
 *
 * Цена решения названа владельцу и принята: на одной стороне «кто сказал»
 * читается только цветом, и это медленнее, чем стороной.
 *
 * Подряд идущие от одного автора собираются в группу и не повторяют имя;
 * время живёт в нижнем углу пузыря; день отбивается плашкой по центру.
 */

/** Столько времени между сообщениями — и группа начинается заново. */
const REGROUP_MS = 5 * 60 * 1000;

function sameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}

function startsGroup(message: Message, previous: Message | undefined): boolean {
  if (!previous) return true;
  if (previous.author.id !== message.author.id) return true;
  const gap = new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime();
  return gap > REGROUP_MS;
}

function endsGroup(message: Message, next: Message | undefined): boolean {
  return next === undefined || startsGroup(next, message);
}

/**
 * Три и больше переводов строки подряд сжимаются до одного пустого ряда.
 *
 * Хранимый текст не трогаем — по Р-002 он остаётся ровно таким, каким его
 * отправили. Это правило ПОКАЗА: полтора экрана пустоты внутри сообщения
 * разрывают разговор сильнее, чем помогает задуманная автором пауза.
 */
function forDisplay(body: string): string {
  return body.replace(/\n{3,}/gu, "\n\n");
}

/** Кружок с инициалом — вместо картинки, которой у нас нет. */
function initial(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

export interface Row {
  message: Local;
  mine: boolean;
  first: boolean;
  last: boolean;
  /** Следующую реплику говорит уже другой — здесь кончается речь автора. */
  handover: boolean;
  newDay: boolean;
  fresh: boolean;
}

/** Что показать для каждого сообщения. Считается один раз, не в разметке. */
export function rowsOf(messages: Local[], meId: string, wasThere: number | null): Row[] {
  return messages.map((message, index) => {
    const previous = messages[index - 1];
    const first = startsGroup(message, previous);
    return {
      message,
      mine: message.author.id === meId,
      first,
      last: endsGroup(message, messages[index + 1]),
      handover: messages[index + 1]?.author.id !== message.author.id,
      newDay: !previous || !sameDay(new Date(message.createdAt), new Date(previous.createdAt)),
      fresh: wasThere !== null && message.seq > wasThere,
    };
  });
}

/**
 * Реплика в ленте.
 *
 * ⚠️ ПРЕДЕЛ ШИРИНЫ. До него пузырь тянулся во всю ленту: строка в сто
 * знаков, глаз теряет начало следующей. Ширина задана в `ch` — единицах
 * ЗНАКА, а не в пикселях: она поедет вместе со шрифтом, а мера останется
 * той же. Величина взята у Телеграма: около 480 пикселей, то есть
 * 52 знака нашим шрифтом.
 *
 * ⚠️ ВРЕМЯ — ПРИЁМОМ ТЕЛЕГРАМА, И ЭТО ТРЕТЬЯ ПОПЫТКА. Сначала оно стояло
 * встык за последним словом и толкало перенос строки. Потом уехало
 * отдельной строкой под текст — и короткие реплики стали высокими
 * квадратиками, чего в Телеграме нет вовсе.
 *
 * Как сделано у них и теперь у нас: время лежит В УГЛУ пузыря, вынутое
 * из потока, а в конец текста подставлена невидимая распорка его ширины.
 * Распорка и делает всю работу: короткая реплика получает время справа
 * на той же строке, длинная — обтекает его последней строкой. Ни первое,
 * ни второе не требует знать заранее, сколько строк выйдет.
 */
/** Что реплика умеет. Передаётся сверху: пузырь не ходит в данные сам. */
export interface Deeds {
  onReply: (message: Message) => void;
  onForward: (message: Message) => void;
  onPin: (message: Message, pinned: boolean) => void;
  onEdit: (message: Message) => void;
  onRemove: (message: Message) => void;
  /** Войти в режим выделения, начав с этой реплики. */
  onSelect: (message: Message) => void;
}

/** Что сейчас с выделением. `null` — режима выделения нет. */
export interface Picking {
  chosen: Set<string>;
  toggle: (message: Message) => void;
}

/**
 * Меню реплики по правой кнопке.
 *
 * ⚠️ ПОРЯДОК ПУНКТОВ ВЗЯТ У ТЕЛЕГРАМА, А НЕ ПРИДУМАН: ответить, изменить,
 * закрепить, копировать текст, копировать ссылку, переслать, удалить,
 * выделить. Он выглядит произвольным, но им пользуются миллионы рук,
 * и «Ответить» первым, а «Удалить» у самого низа — не вкус, а защита
 * от промаха.
 *
 * ⚠️ «ИЗМЕНИТЬ» И «УДАЛИТЬ» ЕСТЬ ТОЛЬКО У СВОИХ. Показать их у чужой
 * реплики и получить отказ от сервера — худшее из решений: меню обещает
 * то, чего нельзя, и человек узнаёт об этом уже после нажатия. Рубеж стоит
 * на сервере, а здесь — честный вид того же правила.
 *
 * Ссылка на реплику ведёт на `/c/<разговор>/<номер>` — тот самый адрес,
 * по которому лента доматывает до неё и подсвечивает.
 */
function Actions({ row, deeds }: { row: Row; deeds: Deeds }) {
  const { message } = row;
  const pinned = message.pinnedAt !== null;

  return (
    <ContextMenuContent>
      <ContextMenuItem onSelect={() => deeds.onReply(message)}>
        <CornerUpLeft />
        Ответить
      </ContextMenuItem>

      {/* «Изменить» стоит вторым и есть только у своих — так у них. */}
      {row.mine ? (
        <ContextMenuItem onSelect={() => deeds.onEdit(message)}>
          <Pencil />
          Изменить
        </ContextMenuItem>
      ) : null}

      <ContextMenuItem onSelect={() => deeds.onPin(message, !pinned)}>
        {pinned ? <PinOff /> : <Pin />}
        {pinned ? "Открепить" : "Закрепить"}
      </ContextMenuItem>

      <ContextMenuItem onSelect={() => void copy(message.body)}>
        <Copy />
        Копировать текст
      </ContextMenuItem>
      <ContextMenuItem
        onSelect={() =>
          void copy(`${window.location.origin}/c/${message.conversationId}/${message.seq}`)
        }
      >
        <Link2 />
        Копировать ссылку
      </ContextMenuItem>

      <ContextMenuItem onSelect={() => deeds.onForward(message)}>
        <Forward />
        Переслать
      </ContextMenuItem>

      {row.mine ? (
        <ContextMenuItem variant="destructive" onSelect={() => deeds.onRemove(message)}>
          <Trash2 />
          Удалить
        </ContextMenuItem>
      ) : null}

      <ContextMenuSeparator />

      <ContextMenuItem onSelect={() => deeds.onSelect(message)}>
        <SquareCheck />
        Выделить
      </ContextMenuItem>
    </ContextMenuContent>
  );
}

/**
 * Речь одного человека подряд — одной группой с общим кружком.
 *
 * ⚠️ КРУЖОК ПРИЛИПАЕТ КО ДНУ ОКНА (`sticky`), пока группа на экране.
 * Так в Телеграме, и это не украшение: у длинной реплики или у десяти
 * подряд кружок иначе уезжает за нижний край, и посреди чужой стены
 * текста уже не видно, чья она. Приклеенный кружок отвечает на «кто это
 * говорит» в любой точке прокрутки.
 *
 * Как это держится: столбец слева тянется на всю высоту группы
 * (обычное поведение флекса), внутри него кружок прижат книзу и объявлен
 * липким. Липкому нужен ХОД — то есть колонка выше него самого; поэтому
 * колонка отдельная, а не `align-self` у самого кружка. Без хода
 * `sticky` тихо ничего не делает, и это самая частая ошибка с ним.
 *
 * ⚠️ РАЗМЕР КРУЖКА — ЧАСТЬ ТОГО ЖЕ ОТВЕТА. У Телеграма кружок примерно
 * равен высоте однострочного пузыря, и потому на коротких репликах ему
 * просто НЕКУДА ехать: липкость там ничего не делает, и глазу кажется,
 * что её нет. У нас кружок был 28 при пузыре в 39 — оставался запас,
 * и на однострочных он подрагивал. Замечено владельцем, и объяснение
 * его же. Отсюда 32 пикселя и более плотная строка в пузыре.
 *
 * ⚠️ ОТСТУП РОВНО НОЛЬ, И ЭТО НЕ ЛЕНЬ. Сначала стояло 12 пикселей —
 * «чтобы не липло к самому краю». Но отступ у липкого означает не поле,
 * а ПОРОГ: кружок начинает всплывать, едва низ группы подойдёт к нижнему
 * краю на это расстояние. У последней группы в ленте он от этого висел
 * на 32 пикселя выше своего пузыря — замерено, а не показалось.
 * С нулём кружок стоит на месте ровно до тех пор, пока группа не полезла
 * ЗА нижний край, — а это и есть тот единственный случай, ради которого
 * липкость затевалась.
 */
export function Group({
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
  const first = rows[0];
  const last = rows[rows.length - 1];
  if (!first || !last) return null;

  return (
    <div
      className={[
        "flex gap-2",
        // Между людьми разрыв заметный, между группами одного — поменьше.
        last.handover ? "mb-4" : "mb-2.5",
      ].join(" ")}
    >
      <div className="flex w-8 shrink-0 flex-col justify-end">
        <span
          aria-hidden="true"
          className="sticky bottom-0 grid size-8 place-items-center rounded-pill bg-accent-soft text-mark text-ink-on-soft"
        >
          {initial(first.message.author.name)}
        </span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
        {rows.map((row) => (
          <Bubble key={row.message.id} row={row} deeds={deeds} onGo={onGo} picking={picking} />
        ))}
      </div>
    </div>
  );
}

/** Разложить ленту по группам: подряд идущие реплики одного автора. */
export function groupsOf(rows: Row[]): Row[][] {
  const groups: Row[][] = [];
  for (const row of rows) {
    // Новый день всегда начинает группу: между ними встаёт плашка с датой,
    // и группа, перешагнувшая полночь, разорвалась бы этой плашкой пополам.
    if (row.first || row.newDay || groups.length === 0) groups.push([row]);
    else groups[groups.length - 1]?.push(row);
  }
  return groups;
}

/**
 * Что стало с моей репликой — значком рядом со временем.
 *
 * ⚠️ ОДНА ГАЛОЧКА, А НЕ ДВЕ. В Телеграме вторая означает «прочитано»,
 * а мы про прочтение не знаем ничего: отметок чтения у нас нет. Две
 * галочки были бы не украшением, а утверждением, которого мы не можем
 * проверить. Одна честно значит «дошло до сервера».
 *
 * У чужих реплик значка нет вовсе: их доставка — не наше дело.
 */
function State({ row }: { row: Row }) {
  if (!row.mine) return null;
  if (row.message.state === "идёт") {
    return <Clock3 aria-label="отправляется" className="size-3 opacity-70" />;
  }
  if (row.message.state === "не ушло") {
    return <AlertCircle aria-label="не ушло" className="size-3 text-danger" />;
  }
  return <Check aria-label="доставлено" className="size-3 opacity-70" />;
}

/**
 * Щелчок по строке в режиме выделения.
 *
 * ⚠️ РЯДОМ С НИМ ОБЯЗАН БЫТЬ ОБРАБОТЧИК КЛАВИАТУРЫ. Строка — не кнопка,
 * и без него она нажимается только мышью: тот, кто ходит по интерфейсу
 * с клавиатуры, выделить ничего не сможет.
 */
function pickHandlers(row: Row, picking: Picking | null) {
  if (!picking) return {};
  return {
    onClick: () => picking.toggle(row.message),
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      picking.toggle(row.message);
    },
  };
}

/** Галочка выделения справа от пузыря. */
function Tick({ row, picking, chosen }: { row: Row; picking: Picking | null; chosen: boolean }) {
  if (!picking) return null;
  return (
    <button
      type="button"
      aria-pressed={chosen}
      aria-label={chosen ? "Снять выделение" : "Выделить"}
      onClick={(event) => {
        // Щелчок по галочке не должен сработать дважды: строка выше
        // слушает то же событие.
        event.stopPropagation();
        picking.toggle(row.message);
      }}
      className={[
        "mt-auto mb-1 ml-2 grid size-5 shrink-0 place-items-center rounded-pill border transition-colors",
        chosen ? "border-accent bg-accent text-on-accent" : "border-edge bg-transparent",
      ].join(" ")}
    >
      {chosen ? <Check className="size-3" /> : null}
    </button>
  );
}

/** Шапка пузыря: откуда переслано и кто говорит. */
function Head({ row }: { row: Row }) {
  const soft = row.mine;
  return (
    <>
      {row.message.forwardedFrom ? (
        <span
          className={[
            "mb-0.5 block text-mark italic",
            soft ? "text-muted-on-soft" : "text-muted",
          ].join(" ")}
        >
          Переслано от {row.message.forwardedFrom}
        </span>
      ) : null}

      {row.first ? (
        <span
          className={[
            "mb-0.5 block text-aside font-medium",
            // Внутри своего пузыря — своя роль: он залит, и обычный
            // текстовый акцент на нём не читается.
            soft ? "text-ink-on-soft" : "text-accent-ink",
          ].join(" ")}
        >
          {row.message.author.name}
        </span>
      ) : null}
    </>
  );
}

/** Подпись в углу: изменено, время, состояние доставки. */
function Corner({ row }: { row: Row }) {
  return (
    <span
      className={[
        "absolute right-3 bottom-2 flex items-center gap-1 text-mark",
        row.mine ? "text-muted-on-soft" : "text-muted",
      ].join(" ")}
    >
      {row.message.editedAt ? <span title="изменено">изм.</span> : null}
      <time dateTime={row.message.createdAt}>{часы.format(new Date(row.message.createdAt))}</time>
      <State row={row} />
    </span>
  );
}

/**
 * Реплика: пузырь, цитата, подпись и меню по правой кнопке.
 *
 * Шапка и подпись вынесены отдельными кусками не ради красоты: гейт
 * сложности был прав — в одной функции набралось семь условий поверх
 * разметки, и такое читается только целиком.
 */
export function Bubble({
  row,
  deeds,
  onGo,
  picking,
}: {
  row: Row;
  deeds: Deeds;
  onGo: (seq: number) => void;
  /** Идёт выделение. `null` — обычный режим. */
  picking: Picking | null;
}) {
  const chosen = picking?.chosen.has(row.message.id) ?? false;
  const pick = pickHandlers(row, picking);
  return (
    // data-seq — по нему лента находит реплику при переходе из цитаты.
    <article
      data-seq={row.message.seq}
      /* `flex` здесь не для раскладки, а чтобы область меню по правой
         кнопке стала блочной: Radix рисует её строчным тегом, а строчный
         не слушается ни ширины, ни полей — пузыри складывались в полоску
         шириной в один знак. */
      /* `w-full`, чтобы подсветка перехода легла ПОЛОСОЙ, а не по контуру
         пузыря: без этого строка сжимается до ширины текста, и заливать
         нечего. Пузырь внутри всё равно ограничен своими 52 знаками. */
      className={[
        "msg flex w-full max-w-full",
        row.fresh ? "msg-fresh" : "",
        // В режиме выделения щелчок по всей строке переключает выбор,
        // поэтому строка целиком становится нажимаемой и подсвечивается.
        picking ? "cursor-pointer rounded-sm" : "",
        chosen ? "bg-selected" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={pick.onClick}
      onKeyDown={pick.onKeyDown}
    >
      <ContextMenu>
        <ContextMenuTrigger
          className={[
            // ⚠️ `text-body` СТОИТ ЗДЕСЬ РАДИ `ch`, А НЕ РАДИ ВИДА. Предел
            // ширины задан в знаках, а знак считается по шрифту ТОГО ЖЕ
            // элемента: размер текста стоял только на внутренней строке,
            // и предел молча раздувался с 483 до 721 пикселя.
            // 52 знака — около 480 пикселей, как у Телеграма на десктопе.
            "relative max-w-[52ch] min-w-0 px-3 py-2 text-left text-body shadow-raised",
            // Хвостик слева у обоих: пузырь растёт от кружка, а кружок
            // теперь один и тот же с одной стороны.
            "rounded-lg rounded-bl-sm",
            row.mine
              ? "border border-accent-soft-edge bg-accent-soft text-ink-on-soft"
              : "border border-line bg-card text-ink",
          ].join(" ")}
        >
          <Head row={row} />

          {/* Цитата ВНУТРИ пузыря и выше текста: она объясняет, к чему
              относится сказанное, и потому обязана быть прочитана первой. */}
          {row.message.replyTo ? (
            <Quote
              quote={row.message.replyTo}
              tone={row.mine ? "на заливке" : "обычный"}
              onGo={() => {
                const seq = row.message.replyTo?.seq;
                if (seq !== undefined) onGo(seq);
              }}
            />
          ) : null}

          <span className="block text-body leading-snug break-words whitespace-pre-wrap">
            <RichText body={forDisplay(row.message.body)} />
            {/* Распорка под время. Шире самого времени на волосок, чтобы
                между ними остался просвет. Для чтения вслух её нет. */}
            <span aria-hidden="true" className="inline-block w-12 select-none" />
          </span>

          <Corner row={row} />
        </ContextMenuTrigger>
        <Actions row={row} deeds={deeds} />
      </ContextMenu>

      {/* Галочка справа от пузыря, а не внутри: внутри она соревновалась бы
          с текстом за место и уезжала бы под время. */}
      <Tick row={row} picking={picking} chosen={chosen} />
    </article>
  );
}
