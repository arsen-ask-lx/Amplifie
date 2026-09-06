import { useCallback, useEffect, useState } from "react";
import { ApiError, api, type Bridge } from "./api.js";

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

/** Как часто перечитываем состояние, пока экран открыт. */
const REFRESH_MS = 4000;

const when = new Intl.DateTimeFormat("ru", { hour: "2-digit", minute: "2-digit" });

/** Что сказать человеку по коду отказа. Каждую причину чинят по-разному. */
function explain(error: unknown): string {
  if (!(error instanceof ApiError)) return "Проверка не удалась — попробуйте ещё раз";
  const detail = (error.body as { detail?: string }).detail;
  switch (error.status) {
    case 503:
      return "Мост не на связи. Запустите строку выше в терминале и не закрывайте окно.";
    case 504:
      return "Мост взял вопрос и не ответил вовремя. Посмотрите в окно терминала.";
    case 502:
      return `Мост ответил отказом: ${detail ?? "причина не названа"}`;
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
        {seen ? ` · последний раз в ${when.format(seen)}` : ""}
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

export function ModelScreen() {
  const [bridges, setBridges] = useState<Bridge[]>([]);
  const [command, setCommand] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [answer, setAnswer] = useState<{ text: string; ms: number } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setBridges((await api.bridges()).items);
    } catch {
      setFailure("Не удалось узнать состояние подключений");
    }
  }, []);

  // Состояние обновляется само: человек запускает мост в другом окне
  // и должен увидеть «на связи», не трогая страницу.
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  async function issue(): Promise<void> {
    setBusy(true);
    setFailure(null);
    setCopied(false);
    try {
      setCommand((await api.createBridgeCode()).command);
      await refresh();
    } catch {
      setFailure("Не удалось выдать код подключения");
    } finally {
      setBusy(false);
    }
  }

  async function copy(): Promise<void> {
    if (!command) return;
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
    } catch {
      // Буфер может быть закрыт настройками браузера. Строка при этом
      // на экране и выделяется — говорим об этом, а не молчим.
      setFailure("Браузер не дал скопировать. Выделите строку и скопируйте сами.");
    }
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

      <section className="work-part" aria-labelledby="ключ">
        <h3 id="ключ">Ключ API</h3>
        <p className="feed-empty">
          Второй путь — обычный ключ, целиком на сайте и без терминала. Появится следующей задачей;
          сюда же, на этот экран.
        </p>
      </section>
    </div>
  );
}
