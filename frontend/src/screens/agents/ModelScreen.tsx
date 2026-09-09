import { useState } from "react";
import { api, type Bridge } from "../../data/api.js";
import { copyAndTell, NOT_COPIED } from "../../shared/clipboard.js";
import { detailOf } from "../../shared/failure.js";
import { СКОПИРОВАНО } from "../../shared/toast.js";
import { troubleOf } from "../../shared/trouble.js";
import { Button } from "../../shared/ui/button.js";
import { часы } from "../../shared/when.js";

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
    <p className="flex flex-wrap items-center gap-2 text-body text-ink">
      <span className={bridge.online ? "dot dot-on" : "dot"} aria-hidden="true" />
      <b>{bridge.name ?? "код выдан, машина ещё не подключалась"}</b>
      <span className="text-aside text-muted">
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
      <p className="mt-2 text-aside text-muted">
        Выполните это у себя один раз. Код одноразовый и живёт 15 минут.
      </p>
      <input
        className="h-9 w-full rounded-lg border border-edge bg-card px-3 text-aside text-ink outline-none"
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
        <blockquote className="mt-3 rounded border-l-2 border-accent bg-panel px-3 py-2">
          <p className="text-body leading-relaxed text-ink">{answer.text}</p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-aside text-muted">
            <span>ответ настоящей модели за {(answer.ms / 1000).toFixed(1)} с</span>
          </p>
        </blockquote>
      ) : null}
      {failure ? <p className="mt-3 text-aside text-danger">{failure}</p> : null}
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
    if (await copyAndTell(command, СКОПИРОВАНО.текст)) setCopied(true);
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
    <div className="flex-1 overflow-y-auto p-5">
      <section className="mb-6" aria-labelledby="подписка">
        <h3 id="подписка" className="mb-3 text-lead font-semibold text-ink">
          Своя подписка
        </h3>

        <article className="mb-3 rounded-xl border border-line bg-card p-4 shadow-raised">
          <p className="text-lead leading-snug text-ink">
            Модель отвечает через ваш собственный клиент, на вашей машине. Токен подписки остаётся у
            вас: мы его не видим и не храним.
          </p>

          {bridges.length > 0 ? (
            <div className="mt-3 flex flex-col gap-1">
              {bridges.map((bridge) => (
                <State key={bridge.id} bridge={bridge} />
              ))}
            </div>
          ) : null}

          {command ? <Command command={command} /> : null}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button disabled={busy} onClick={() => void issue()}>
              {command ? "Новый код" : "Подключить"}
            </Button>
            {command ? (
              <Button variant="outline" onClick={() => void copy()}>
                {copied ? "Скопировано" : "Скопировать"}
              </Button>
            ) : null}
            <Button variant="outline" disabled={busy} onClick={() => void check()}>
              {busy ? "Спрашиваем…" : "Проверить"}
            </Button>
          </div>

          <Outcome answer={answer} failure={failure} />

          {!connected && !command ? (
            <p className="mt-2 text-aside text-muted">
              Нужен установленный <code>claude</code>, в который вы вошли. Проверка спрашивает
              настоящую модель — иначе не отличить рабочее подключение от истёкшего.
            </p>
          ) : null}
        </article>
      </section>
    </div>
  );
}
