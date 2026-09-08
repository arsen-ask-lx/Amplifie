import { useState } from "react";
import { parseMarkup, type Token } from "./markup.js";

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
function Spoiler({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  if (open) return <span>{text}</span>;
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
      <span className="invisible">{text}</span>
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

const VIEWS: Record<Token["kind"], (token: Token) => React.ReactNode> = {
  text: (t) => <span>{t.text}</span>,
  bold: (t) => <strong>{t.text}</strong>,
  italic: (t) => <em>{t.text}</em>,
  underline: (t) => <u>{t.text}</u>,
  strike: (t) => <s>{t.text}</s>,
  code: (t) => (
    <code className="rounded-sm bg-current/12 px-1 py-0.5 font-mono text-[0.92em]">{t.text}</code>
  ),
  // Многострочный кусок кода — блоком: он не течёт по строке, он ею не является.
  pre: (t) => <CodeBlock text={t.text} lang={t.kind === "pre" ? t.lang : undefined} />,
  spoiler: (t) => <Spoiler text={t.text} />,
  link: (t) => <Link text={t.text} href={t.kind === "link" ? t.href : ""} />,
};

/**
 * Блок кода.
 *
 * ⚠️ НИКАКОЙ ШАПКИ, ПОКА ЯЗЫК НЕ НАЗВАН, И НИКАКОЙ КНОПКИ. Первая
 * редакция дописывала подпись «КОД» и кнопку «Скопировать» со словом
 * «Скопировано» после нажатия — этого нет у Телеграма, и владелец
 * поправил. Подпись появляется, только если её написал сам человек
 * в ограде (```sql): это его текст, а не наша выдумка.
 *
 * ⚠️ ПРОКРУТКА СВОЯ, А НЕ У СТРАНИЦЫ. Широкая таблица внутри сообщения
 * не имеет права двигать всю ленту вбок — это уже было замечанием.
 */
function CodeBlock({ text, lang }: { text: string; lang: string | undefined }) {
  return (
    <span className="my-1.5 block overflow-hidden rounded-md bg-current/10">
      {lang ? (
        <span className="block px-2.5 pt-1.5 text-mark tracking-wide text-current/60 lowercase">
          {lang}
        </span>
      ) : null}
      <code className="block overflow-x-auto px-2.5 py-2 font-mono text-[0.92em] leading-snug whitespace-pre">
        {text}
      </code>
    </span>
  );
}

export function RichText({ body }: { body: string }) {
  return (
    <>
      {/* ⚠️ КЛЮЧ ПО МЕСТУ, И ЭТО ЕДИНСТВЕННЫЙ ВЕРНЫЙ ВЫБОР ЗДЕСЬ. Ключ
          из вида и текста выглядел аккуратнее и разваливался на первом же
          сообщении с двумя одинаковыми кусками: «два ребёнка с одним
          ключом». Список ПОЗИЦИОННЫЙ — куски не переставляются и не
          удаляются по одному, он пересобирается целиком при изменении
          текста, — поэтому место и есть их настоящее имя. */}
      {parseMarkup(body).map((token, at) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: список позиционный, см. выше
        <span key={`${at}-${token.kind}`}>{VIEWS[token.kind](token)}</span>
      ))}
    </>
  );
}
