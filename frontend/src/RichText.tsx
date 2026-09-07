import { parseMarkup } from "./markup.js";

/**
 * Отрисовка размеченного текста.
 *
 * Имя не `Markup`: разборщик уже зовётся `markup.ts`, а на Windows файлы,
 * различающиеся только регистром, — это один файл. Такое ловится не
 * компилятором, а сборкой на чужой машине.
 *
 * Ни одной строки HTML: куски превращаются в обычные узлы React, поэтому
 * `dangerouslySetInnerHTML` здесь не нужен — и запрещён гейтом на весь
 * `apps/web`. Целый класс дыр (внедрение HTML) отсутствует не потому,
 * что мы аккуратны, а потому что такого пути нет.
 *
 * У ссылок `rel` не украшение:
 *   noopener  — открытая страница не получает доступ к нашей через
 *               `window.opener` и не может увести человека подменой адреса;
 *   noreferrer — чужой сайт не узнаёт, из какого пространства пришли;
 *   nofollow  — переписка не раздаёт вес ссылкам, в том числе спамным.
 */
export function RichText({ body }: { body: string }) {
  return (
    <>
      {parseMarkup(body).map((token, index) => {
        // Ключ по месту: куски не переставляются и не удаляются по одному,
        // список пересобирается целиком при изменении текста.
        const key = `${index}-${token.kind}`;

        if (token.kind === "bold") return <strong key={key}>{token.text}</strong>;
        if (token.kind === "italic") return <em key={key}>{token.text}</em>;
        if (token.kind === "code") return <code key={key}>{token.text}</code>;
        if (token.kind === "link") {
          return (
            <a key={key} href={token.href} target="_blank" rel="noopener noreferrer nofollow">
              {token.text}
            </a>
          );
        }
        return <span key={key}>{token.text}</span>;
      })}
    </>
  );
}
