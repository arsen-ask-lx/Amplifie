import { AlertCircle, Check, Clock3, Copy, Link2 } from "lucide-react";
import type { Message } from "../../data/api.js";
import type { Local } from "../../data/useChat.js";
import { copy } from "../../shared/clipboard.js";
import { RichText } from "../../shared/RichText.js";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "../../shared/ui/context-menu.js";
import { часы } from "../../shared/when.js";

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
/**
 * Меню реплики по правой кнопке.
 *
 * ⚠️ ЗДЕСЬ ТОЛЬКО ТО, ЧТО РАБОТАЕТ. «Ответить», «Закрепить», «Изменить»,
 * «Удалить» в Телеграме тоже есть, и владелец их назвал — но у нас под
 * ними нет ни поля в базе, ни ручки на сервере. Пункт, который ничего
 * не делает, хуже отсутствующего: он врёт про возможности, и врёт молча.
 * Появятся на сервере — появятся здесь.
 *
 * Ссылка на реплику ведёт на `/c/<разговор>/<номер>` — тот самый адрес,
 * по которому лента доматывает до неё и подсвечивает.
 */
function Actions({ message }: { message: Message }) {
  return (
    <ContextMenuContent>
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
export function Group({ rows }: { rows: Row[] }) {
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
          <Bubble key={row.message.id} row={row} />
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

export function Bubble({ row }: { row: Row }) {
  const at = new Date(row.message.createdAt);

  return (
    // data-seq — по нему лента находит реплику при переходе из цитаты.
    <article
      data-seq={row.message.seq}
      /* `flex` здесь не для раскладки, а чтобы область меню по правой
         кнопке стала блочной: Radix рисует её строчным тегом, а строчный
         не слушается ни ширины, ни полей — пузыри складывались в полоску
         шириной в один знак. */
      className={["msg flex max-w-full", row.fresh ? "msg-fresh" : ""].filter(Boolean).join(" ")}
    >
      <ContextMenu>
        <ContextMenuTrigger
          className={[
            // ⚠️ `text-body` СТОИТ ЗДЕСЬ РАДИ `ch`, А НЕ РАДИ ВИДА. Предел
          // ширины задан в знаках, а знак считается по шрифту ТОГО ЖЕ
          // элемента. Размер текста стоял только на внутренней строке,
          // пузырю доставались унаследованные 16 пикселей вместо наших 14 —
          // и предел молча раздувался с 483 до 721 пикселя. Мера, которая
          // меряет не тем, чем показывает, хуже отсутствующей.
          //
          // 52 знака — примерно 480 пикселей, ровно как у Телеграма
          // на десктопе. Раньше стояло 68 — оттуда и «блок шире, чем в тг»
          // (владелец, замечание с экрана).
          "relative max-w-[52ch] min-w-0 px-3 py-2 text-left text-body shadow-raised",
            // Хвостик слева у обоих: пузырь растёт от кружка, а кружок
            // теперь один и тот же с одной стороны.
            "rounded-lg rounded-bl-sm",
            row.mine
              ? "border border-accent-soft-edge bg-accent-soft text-ink-on-soft"
              : "border border-line bg-card text-ink",
          ].join(" ")}
        >
          {row.first ? (
            <span
              className={[
                "mb-0.5 block text-aside font-medium",
                // Внутри своего пузыря — своя роль: он залит, и обычный
                // текстовый акцент на нём не читается.
                row.mine ? "text-ink-on-soft" : "text-accent-ink",
              ].join(" ")}
            >
              {row.message.author.name}
            </span>
          ) : null}
          <span className="block text-body leading-snug break-words whitespace-pre-wrap">
            <RichText body={forDisplay(row.message.body)} />
            {/* Распорка под время. Шире самого времени на волосок, чтобы
              между ними остался просвет. Для чтения вслух её нет. */}
            <span aria-hidden="true" className="inline-block w-12 select-none" />
          </span>
          <span
            className={[
              "absolute right-3 bottom-2 flex items-center gap-1 text-mark",
              row.mine ? "text-muted-on-soft" : "text-muted",
            ].join(" ")}
          >
            <time dateTime={row.message.createdAt}>{часы.format(at)}</time>
            <State row={row} />
          </span>
        </ContextMenuTrigger>
        <Actions message={row.message} />
      </ContextMenu>
    </article>
  );
}
