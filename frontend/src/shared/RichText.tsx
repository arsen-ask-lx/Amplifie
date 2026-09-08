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
      className="rounded-sm bg-current px-1 align-baseline text-transparent select-none"
    >
      {text}
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
  pre: (t) => (
    <code className="my-1 block overflow-x-auto rounded bg-current/12 px-2 py-1.5 font-mono text-[0.92em] whitespace-pre">
      {t.text}
    </code>
  ),
  spoiler: (t) => <Spoiler text={t.text} />,
  link: (t) => <Link text={t.text} href={t.kind === "link" ? t.href : ""} />,
};

export function RichText({ body }: { body: string }) {
  return (
    <>
      {/* Ключ собирается из вида и самого текста: куски не переставляются
          и не удаляются по одному — список пересобирается целиком при
          изменении текста, — поэтому ключ нужен лишь чтобы React не путал
          соседей одного вида. */}
      {parseMarkup(body).map((token) => (
        <span key={`${token.kind}:${token.text}`}>{VIEWS[token.kind](token)}</span>
      ))}
    </>
  );
}
