import { useState } from "react";
import { api, type Bridge } from "./api.js";
import { NOT_COPIED, copy as toClipboard } from "./shared/clipboard.js";
import { detailOf } from "./shared/failure.js";
import { troubleOf } from "./shared/trouble.js";
import { часы } from "./shared/when.js";

/**
 * «Подключить свою нейросеть» (task-001).
 *
 * У каждого своя подписка, и работает она на его машине. Здесь человек
 * берёт код, копирует одну строку и видит, что связь появилась.
 *
 * Почему подписку нельзя, как ключ, вставить в поле на сайте: у неё нет
 * такой строки — она привязана к входу в клиент на конкретной машине.
 * А если бы была, это был бы токен подписки, и его нам держать нельзя
 * (Р-012). Это сказано на экране прямо, а не спрятано в документации:
 * иначе человек будет искать поле для вставки и решит, что мы недоделали.
 */

/**
 * Что сказать человеку. Причину считает общий слой, слова — здесь: этот
 * экран про НАЛАДКУ связи, поэтому в них есть «запустите строку выше»,
 * которого в чате быть не должно.
 */
function explain(error: unknown): string {
  switch (troubleOf(error)) {
    case "нет-модели":
      return "Мост не на связи. Запустите строку выше в терминале и не закрывайте окно.";
    case "мост-молчит":
      return "Мост взял вопрос и не ответил вовремя. Посмотрите в окно терминала.";
    case "модель-отказала":
      return `Мост ответил отказом: ${detailOf(error) ?? "причина не названа"}`;
    default:
      return "Проверка не удалась — попробуйте ещё раз";
  }
}

function State({ bridge }: { bridge: Bridge }) {
  const seen = bridge.lastSeenAt ? new Date(bridge.lastSeenAt) : null;
  return (
    <p className="link-state">
      <span className={bridge.online ? "dot dot-on" : "dot"} aria-hidden="true" />
      <b>{bridge.name ?? "код выдан, машина ещё не подключалась"}</b>
      <span className="link-when">
        {bridge.online ? "на связи" : bridge.joined ? "нет связи" : "ждёт запуска"}
        {seen ? ` · последний раз в ${часы.format(seen)}` : ""}
      </span>
    </p>
  );
}

/** Строка запуска: показывается один раз, копируется одной кнопкой. */
function Command({ command }: { command: string }) {
  return (
    <>
      <p className="deal-where">Выполните это у себя один раз. Код одноразовый и живёт 15 минут.</p>
      <input
        className="invite-link"
        readOnly
        value={command}
        onFocus={(event) => event.target.select()}
        aria-label="Строка запуска моста"
      />
    </>
  );
}

/** Что вышло из проверки: ответ модели либо причина отказа. */
function Outcome({
  answer,
  failure,
}: {
  answer: { text: string; ms: number } | null;
  failure: string | null;
}) {
  return (
    <>
      {answer ? (
        <blockquote className="cite">
          <p className="cite-text">{answer.text}</p>
          <p className="cite-who">
            <span>ответ настоящей модели за {(answer.ms / 1000).toFixed(1)} с</span>
          </p>
        </blockquote>
      ) : null}
      {failure ? <p className="cite-none">{failure}</p> : null}
    </>
  );
}

/**
 * Мосты приходят СВОЙСТВАМИ, а не своим запросом.
 *
 * Этот экран рисуется только внутри «Агентов», и до task-012 оба
 * опрашивали сервер каждые 4 секунды двумя таймерами — притом что
 * состояние моста есть в обоих ответах. Два таймера на один вопрос —
 * это не удвоенная свежесть, а два разных момента правды.
 */
export function ModelScreen({
  bridges,
  onChanged,
}: {
  bridges: Bridge[];
  onChanged: () => void | Promise<void>;
}) {
  const [command, setCommand] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [answer, setAnswer] = useState<{ text: string; ms: number } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function issue(): Promise<void> {
    setBusy(true);
    setFailure(null);
    setCopied(false);
    try {
      setCommand((await api.createBridgeCode()).command);
      await onChanged();
    } catch {
      setFailure("Не удалось выдать код подключения");
    } finally {
      setBusy(false);
    }
  }

  async function copy(): Promise<void> {
    if (!command) return;
    // Строка при этом на экране и выделяется — поэтому отказ буфера
    // не поломка, а повод сказать словами (shared/clipboard.ts).
    if (await toClipboard(command)) setCopied(true);
    else setFailure(NOT_COPIED);
  }

  async function check(): Promise<void> {
    setBusy(true);
    setFailure(null);
    setAnswer(null);
    try {
      setAnswer(await api.checkModel("Назови столицу Португалии одним словом."));
    } catch (error) {
      setFailure(explain(error));
    } finally {
      setBusy(false);
    }
  }

  const connected = bridges.some((one) => one.online);

  return (
    <div className="work">
      <section className="work-part" aria-labelledby="подписка">
        <h3 id="подписка">Своя подписка</h3>

        <article className="deal">
          <p className="deal-text">
            Модель отвечает через ваш собственный клиент, на вашей машине. Токен подписки остаётся у
            вас: мы его не видим и не храним.
          </p>

          {bridges.length > 0 ? (
            <div className="links">
              {bridges.map((bridge) => (
                <State key={bridge.id} bridge={bridge} />
              ))}
            </div>
          ) : null}

          {command ? <Command command={command} /> : null}

          <div className="deal-do">
            <button type="button" disabled={busy} onClick={() => void issue()}>
              {command ? "Новый код" : "Подключить"}
            </button>
            {command ? (
              <button type="button" onClick={() => void copy()}>
                {copied ? "Скопировано" : "Скопировать"}
              </button>
            ) : null}
            <button type="button" className="quiet" disabled={busy} onClick={() => void check()}>
              {busy ? "Спрашиваем…" : "Проверить"}
            </button>
          </div>

          <Outcome answer={answer} failure={failure} />

          {!connected && !command ? (
            <p className="deal-where">
              Нужен установленный <code>claude</code>, в который вы вошли. Проверка спрашивает
              настоящую модель — иначе не отличить рабочее подключение от истёкшего.
            </p>
          ) : null}
        </article>
      </section>
    </div>
  );
}
