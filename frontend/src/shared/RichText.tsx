import { Check, Copy } from "@phosphor-icons/react";
import { useState } from "react";
import { copyAndTell } from "./clipboard.js";
import { parseMarkup, type Token, type Wrap } from "./markup.js";
import { СКОПИРОВАНО } from "./toast.js";

/**
 * Отрисовка размеченного текста.
 *
 * Имя не `Markup`: разборщик уже зовётся `markup.ts`, а на Windows файлы,
 * различающиеся только регистром, — это один файл. Такое ловится не
 * компилятором, а сборкой на чужой машине.
 *
 * Ни одной строки HTML: куски превращаются в обычные узлы React, поэтому
 * `dangerouslySetInnerHTML` здесь не нужен — и запрещён гейтом. Целый класс
 * дыр (внедрение HTML) отсутствует не потому, что мы аккуратны, а потому
 * что такого пути нет.
 *
 * ⚠️ ПОДЛОЖКИ БЕРУТСЯ ОТ ЦВЕТА ТЕКСТА (`bg-current`), А НЕ ОТ РОЛИ.
 * Роль знает про страницу, но не про пузырь: внутри СВОЕГО пузыря фон
 * перевёрнут — светлый в тёмной теме, — и `bg-panel` давал там чёрную
 * плашку с чёрным текстом. Цвет текста же всегда верен для своего места,
 * поэтому подложка из него с малой непрозрачностью читается и на светлом,
 * и на тёмном, и в любой из семи палитр. Найдено живым прогоном.
 *
 * ⚠️ ВИДЫ РАЗЛОЖЕНЫ ТАБЛИЦЕЙ, А НЕ ЛЕСТНИЦЕЙ `if`. Их восемь, и лестница
 * из восьми ступеней читается только целиком — гейт сложности был прав.
 * У таблицы же видно с одного взгляда, что вид разметки ровно один
 * на каждый вид куска.
 */

/** Скрытый кусок: залит, пока не нажмут. */
function Spoiler({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  if (open) return <span>{children}</span>;
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label="Показать скрытое"
      // Открывается нажатием и обратно не закрывается: прятать то, что
      // человек уже прочитал, — не забота, а издевательство.
      className="rounded-sm bg-current px-1 align-baseline select-none"
    >
      {/* ⚠️ ТЕКСТ ПРЯЧЕТСЯ `visibility`, А НЕ ПРОЗРАЧНЫМ ЦВЕТОМ. Первая
          редакция ставила `text-transparent` НА ТОТ ЖЕ узел, что и
          `bg-current`, — и заливка тоже становилась прозрачной: она берётся
          из текущего цвета текста, который только что обнулили. Скрытое
          превращалось в пустое место, и владелец справедливо прочёл это
          как «буква уехала». `visibility` держит и место, и цвет. */}
      <span className="invisible">{children}</span>
    </button>
  );
}

/**
 * Ссылка.
 *
 * `rel` здесь не украшение:
 *   noopener   — открытая страница не получает доступ к нашей через
 *                `window.opener` и не может увести человека подменой адреса;
 *   noreferrer — чужой сайт не узнаёт, из какого пространства пришли;
 *   nofollow   — переписка не раздаёт вес ссылкам, в том числе спамным.
 */
function Link({ text, href }: { text: string; href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="text-link underline underline-offset-2 hover:opacity-80"
    >
      {text}
    </a>
  );
}

/**
 * Упоминание человека (Р-031).
 *
 * ⚠️ ПОДЛОЖКОЙ, А НЕ ЦВЕТОМ, И ЭТО ИСПРАВЛЕНИЕ ПО ЗАМЕЧАНИЮ ВЛАДЕЛЬЦА:
 * «надпись есть, но она сливается». Сперва зов красился акцентной ролью —
 * той же, что имя автора. На чужом пузыре она читается, а на СВОЁМ
 * в шести темах из девятнадцати не дотягивает до порога, а в монохроме
 * совпадает с заливкой знак в знак: 1.00:1, белым по белому.
 *
 * Подложка берёт цвет у самого текста (`bg-current/12`), поэтому она
 * читается в любой теме по построению, а не по совпадению — новой пары
 * цветов не заводится вовсе. Тот же приём и та же плотность, что
 * у моноширинного куска ниже: в ленте это уже знакомый глазу знак
 * «здесь не обычные слова».
 *
 * ⚠️ НЕ ССЫЛКА. Подчёркивание и переход означают «уйдёшь отсюда»;
 * уходить некуда — экрана человека у нас нет. Нарисовать ссылку,
 * которая никуда не ведёт, значит соврать нажатием.
 *
 * Номер участника в разметку не попадает: он нужен серверу для счёта
 * и прав, а на экране от него ничего не зависит.
 */
function Mention({ text }: { text: string }) {
  return <span className="rounded-sm bg-current/12 px-1 font-medium">@{text}</span>;
}

/** Оформление моноширинного куска — одно на ленту и на блок кода. */
const MONO = "rounded-sm bg-current/12 px-1 py-0.5 font-mono text-[0.92em]";

/**
 * Человек ВЫДЕЛЯЕТ текст, а не нажимает.
 *
 * ⚠️ БЕЗ ЭТОЙ ПРОВЕРКИ КОПИРОВАНИЕ ПО НАЖАТИЮ ОТНИМАЕТ ВЫДЕЛЕНИЕ. Кто
 * протащил мышь по куску кода, чтобы взять из него три слова, отпускает
 * её ВНУТРИ куска — и это тоже нажатие. Скопировался бы весь кусок,
 * молча затерев выбранное.
 */
function выделяют(): boolean {
  const выбор = window.getSelection();
  return выбор !== null && !выбор.isCollapsed && выбор.toString().length > 0;
}

/**
 * Моноширинный кусок: нажали — скопировали.
 *
 * ⚠️ ЭТО ПОВЕДЕНИЕ ТЕЛЕГРАМА, А НЕ НАША ВЫДУМКА. У них это
 * `MonospaceClickHandler`, и он вешается на ОБА вида — `Code` и `Pre`:
 * левое или среднее нажатие кладёт текст в буфер и показывает ту же
 * плашку «Текст скопирован в буфер обмена». Текст при этом обрезается
 * по краям (`.trimmed()`) — переносим и это.
 *
 * ⚠️ НАСТОЯЩАЯ КНОПКА, А НЕ `onClick` НА `code`. Кусок обязан быть
 * доступен с клавиатуры: нажатие мышью, которое нельзя повторить
 * табуляцией и пробелом, — это функция, которой нет у половины людей.
 */
function Mono({ text }: { text: string }) {
  return (
    <button
      type="button"
      title="Скопировать"
      onClick={() => {
        if (выделяют()) return;
        void copyAndTell(text.trim(), СКОПИРОВАНО.текст);
      }}
      className="cursor-pointer align-baseline"
    >
      {/* `code` остаётся: кнопка отвечает за нажатие, а смысл «это код»
          несёт узел, и его читает не только глаз, но и чтение с экрана. */}
      <code className={MONO}>{text}</code>
    </button>
  );
}

/**
 * Обёртки: у них не текст, а ДЕТИ, и рисуются они рекурсивно (Р-028).
 * Ровно пять — те же, что вкладываются друг в друга у Телеграма.
 */
const WRAPS: Record<Wrap, (inside: React.ReactNode) => React.ReactNode> = {
  bold: (inside) => <strong>{inside}</strong>,
  italic: (inside) => <em>{inside}</em>,
  underline: (inside) => <u>{inside}</u>,
  strike: (inside) => <s>{inside}</s>,
  spoiler: (inside) => <Spoiler>{inside}</Spoiler>,
};

/**
 * Виды с простым текстом: внутрь них разбор не заходит.
 *
 * ⚠️ ЭТО НЕ НЕДОДЕЛКА, А ЗАПРЕТ. У Телеграма моноширинный и блок кода
 * не совмещаются ни с чем, поэтому звёздочка внутри кода — звёздочка.
 * Ссылка держит простой текст по той же причине, что и раньше: подпись
 * со своей разметкой приносит углы, а пользы не приносит.
 */
const LEAVES = {
  text: (t: { text: string }) => <span>{t.text}</span>,
  code: (t: { text: string }) => <Mono text={t.text} />,
  // Многострочный кусок кода — блоком: он не течёт по строке, он ею не является.
  pre: (t: { text: string; lang?: string }) => <CodeBlock text={t.text} lang={t.lang} />,
  link: (t: { text: string; href: string }) => <Link text={t.text} href={t.href} />,
  mention: (t: { text: string }) => <Mention text={t.text} />,
};

/**
 * Блок кода.
 *
 * ⚠️ ЗНАЧОК БЕЗ ПОДПИСИ, И ПОСЛЕ НАЖАТИЯ — ГАЛОЧКА. Так у Телеграма.
 * Сначала я написал словами «Скопировать» и «Скопировано»; владелец
 * поправил дважды — сперва убрать надписи вовсе, потом вернуть значок
 * с галочкой. Слово занимает место, которого у блока кода нет: справа
 * от него живёт горизонтальная прокрутка.
 *
 * ⚠️ ПОДПИСЬ ЯЗЫКА — ТОЛЬКО ЕСЛИ ЕЁ НАПИСАЛ ЧЕЛОВЕК в ограде (```sql).
 * Своей выдумки вроде «КОД» здесь нет: у Телеграма её нет тоже.
 *
 * ⚠️ ПРОКРУТКА СВОЯ, А НЕ У СТРАНИЦЫ. Широкая таблица внутри сообщения
 * не имеет права двигать всю ленту вбок — это уже было замечанием.
 */
function CodeBlock({ text, lang }: { text: string; lang: string | undefined }) {
  const [copied, setCopied] = useState(false);

  /**
   * ⚠️ ОДНО ДЕЙСТВИЕ НА ДВЕ КНОПКИ. Копируют и значок в углу, и само тело
   * блока; разойдись они — одна из кнопок однажды начала бы копировать
   * не то.
   */
  function скопировать(): void {
    if (выделяют()) return;
    void copyAndTell(text.trim(), СКОПИРОВАНО.код).then((ok) => {
      if (!ok) return;
      setCopied(true);
      // Галочка гаснет: оставшаяся навсегда, она соврёт при следующем
      // взгляде — «а это я сейчас скопировал или вчера?»
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <span className="group/code relative my-1.5 block overflow-hidden rounded-md bg-current/10">
      {lang ? (
        <span className="block px-2.5 pt-1.5 text-mark tracking-wide text-current/60 lowercase">
          {lang}
        </span>
      ) : null}

      <button
        type="button"
        aria-label={copied ? "Скопировано" : "Скопировать код"}
        title={copied ? "Скопировано" : "Скопировать код"}
        onClick={скопировать}
        className={[
          "absolute top-1 right-1 z-10 grid size-7 place-items-center rounded",
          "bg-current/10 text-current/60 backdrop-blur-sm transition-opacity",
          "hover:bg-current/20 hover:text-current focus-visible:opacity-100",
          copied ? "opacity-100" : "opacity-0 group-hover/code:opacity-100",
        ].join(" ")}
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      </button>

      {/* ⚠️ ТЕЛО БЛОКА КОПИРУЕТСЯ ПО НАЖАТИЮ — как у них: тот же
          `MonospaceClickHandler` висит и на `Pre`. Значок в углу при этом
          остаётся: он показывает, что блок вообще можно скопировать,
          а само тело об этом не говорит ничем. */}
      <button
        type="button"
        title="Скопировать"
        onClick={скопировать}
        className="block w-full cursor-pointer overflow-x-auto text-left"
      >
        <code className="block px-2.5 py-2 font-mono text-[0.92em] leading-snug whitespace-pre">
          {text}
        </code>
      </button>
    </span>
  );
}

/**
 * Список кусков → узлы. Зовёт сам себя для детей обёртки.
 *
 * ⚠️ КЛЮЧ ПО МЕСТУ, И ЭТО ЕДИНСТВЕННЫЙ ВЕРНЫЙ ВЫБОР ЗДЕСЬ. Ключ из вида
 * и текста выглядел аккуратнее и разваливался на первом же сообщении
 * с двумя одинаковыми кусками: «два ребёнка с одним ключом». Список
 * ПОЗИЦИОННЫЙ — куски не переставляются и не удаляются по одному,
 * он пересобирается целиком при изменении текста, — поэтому место
 * и есть их настоящее имя.
 */
function nodes(tokens: Token[]): React.ReactNode {
  return tokens.map((token, at) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: список позиционный, см. выше
    <span key={`${at}-${token.kind}`}>
      {"children" in token
        ? WRAPS[token.kind](nodes(token.children))
        : LEAVES[token.kind](token as never)}
    </span>
  ));
}

export function RichText({ body }: { body: string }) {
  return <>{nodes(parseMarkup(body))}</>;
}
