import { Check, Copy } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Bridge } from "../../data/api.js";
import { CHECKMARK_MS, copyQuietly, NOT_COPIED } from "../../shared/clipboard.js";
import { detailOf } from "../../shared/failure.js";
import { troubleOf } from "../../shared/trouble.js";
import { Button } from "../../shared/ui/button.js";
import { Input } from "../../shared/ui/input.js";
import { QUIET_FIELD } from "../../shared/ui/quiet-field.js";
import { timeFormat } from "../../shared/when.js";

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
        {seen ? ` · последний раз в ${timeFormat.format(seen)}` : ""}
      </span>
    </p>
  );
}

/**
 * Строка запуска: показывается один раз, копируется одной кнопкой.
 *
 * ⚠️ ГАЛОЧКА В КОНЦЕ ПОЛЯ, А НЕ НАДПИСЬ НА КНОПКЕ. «Скопировать» →
 * «Скопировано» меняет ширину кнопки, и соседние прыгают следом. Знак
 * стоит там же, где лежит скопированное, — и ничего не двигает.
 * О самом копировании уже сказала плашка; надпись повторяла её третий раз.
 */
function Command({
  command,
  copied,
  onCopy,
}: {
  command: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="relative">
      <Input
        className={`${QUIET_FIELD} pr-11 text-aside`}
        readOnly
        value={command}
        onFocus={(event) => event.target.select()}
        aria-label="Строка запуска моста"
      />
      {/* ⚠️ ЗНАЧОК В САМОМ ПОЛЕ, А НЕ КНОПКА В РЯДУ ДЕЙСТВИЙ. Копирование
          относится к этой строке, а не к окну: рядом с ней ему и место —
          так же, как в Телеграме. Заодно ряд внизу остаётся коротким,
          и в нём видно то, что действительно меняет состояние. */}
      <Button
        className="-translate-y-1/2 absolute top-1/2 right-1"
        variant="ghost"
        size="icon-sm"
        aria-label={copied ? "Скопировано" : "Копировать строку запуска"}
        onClick={onCopy}
      >
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
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
  issueAtOnce = false,
}: {
  bridges: Bridge[];
  onChanged: () => void | Promise<void>;
  /**
   * Выдать код сразу, не дожидаясь нажатия.
   *
   * ⚠️ РЕШАЕТ ХОЗЯИН, И ЭТО НЕ ПРИДИРКА. Каждый код — запись моста
   * на сервере. Там, где окно открыли РАДИ подключения, нажатие
   * «Подключить» лишнее: человек уже сказал, чего хочет. А в разделе
   * «Агенты» панель висит всегда, и автовыдача плодила бы коды
   * на каждый заход в раздел.
   */
  issueAtOnce?: boolean;
}) {
  const [command, setCommand] = useState<string | null>(null);
  /**
   * ⚠️ ДВА ПРИЗНАКА, А НЕ ОДИН ОБЩИЙ «ЗАНЯТ».
   *
   * Пока он был один, нажатие «Новый код» меняло надпись на соседней
   * кнопке на «Спрашиваем…» — то есть экран сообщал о работе, которой
   * не было, да ещё и дёргал раскладку: слово длиннее, кнопка шире.
   * Один признак на две разные работы — это один ответ на два вопроса.
   */
  const [issuing, setIssuing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [answer, setAnswer] = useState<{ text: string; ms: number } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  // Обёрнуто, чтобы следствие ниже могло честно назвать его в зависимостях:
  // без этого выдача пересоздавалась на каждой отрисовке.
  const issue = useCallback(async (): Promise<void> => {
    setIssuing(true);
    setFailure(null);
    setCopied(false);
    try {
      setCommand((await api.createBridgeCode()).command);
      await onChanged();
    } catch {
      setFailure("Не удалось выдать код подключения");
    } finally {
      setIssuing(false);
    }
  }, [onChanged]);

  // Галочка гаснет сама: знак «скопировано» не должен пережить действие.
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), CHECKMARK_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  // Один раз на открытие: в разработке следствия выполняются дважды,
  // и без этой отметки код выдавался бы парой.
  const issued = useRef(false);
  useEffect(() => {
    if (!issueAtOnce || issued.current) return;
    issued.current = true;
    void issue();
  }, [issueAtOnce, issue]);

  async function copy(): Promise<void> {
    if (!command) return;
    // Строка при этом на экране и выделяется — поэтому отказ буфера
    // не поломка, а повод сказать словами (shared/clipboard.ts).
    if (await copyQuietly(command)) setCopied(true);
    else setFailure(NOT_COPIED);
  }

  async function check(): Promise<void> {
    setChecking(true);
    setFailure(null);
    setAnswer(null);
    try {
      setAnswer(await api.checkModel("Назови столицу Португалии одним словом."));
    } catch (error) {
      setFailure(explain(error));
    } finally {
      setChecking(false);
    }
  }

  const machines = bridges.filter((one) => one.joined);

  return (
    /**
     * ⚠️ ЗАГОЛОВКА У ПАНЕЛИ ТОЖЕ НЕТ. Хозяев двое — раздел «Агенты»
     * и окно установки, — и называют они её по-разному: там подзаголовок
     * раздела, здесь заголовок окна. Панель, которая несёт своё имя,
     * во втором хозяине даёт два заголовка подряд.
     *
     * ⚠️ СВОЕЙ РАСКЛАДКИ У ПАНЕЛИ НЕТ, И ЭТО ИСПРАВЛЕНИЕ, А НЕ ВКУС.
     * Здесь стоял `flex-1 overflow-y-auto p-5` — ровно тот же контейнер,
     * что у `AgentsScreen`, ВНУТРИ которого панель и живёт: две вложенные
     * прокрутки и двойные поля. Где панель стоит и как дышит — решает
     * хозяин; иначе её нельзя поставить во второе место, не согласившись
     * на чужие отступы.
     */
    /**
     * ⚠️ ПОРЯДОК ЗДЕСЬ — ЧАСТЬ СМЫСЛА: сверху объяснение, ниже состояние,
     * внизу действия. Кнопки, стоявшие в середине, а подсказка под ними,
     * заставляли читать экран дважды: сперва глазами вниз, потом обратно
     * вверх за причиной.
     */
    <div className="flex flex-col gap-4">
      {/* ⚠️ ТОЛЬКО ПОДКЛЮЧЁННЫЕ МАШИНЫ, А НЕ ВСЕ ВЫДАННЫЕ КОДЫ.
        Каждое нажатие «Новый код» заводит ещё одну запись моста; показывая
        все, панель росла с каждым нажатием, а окно установки расползалось
        вместе с ней. Невостребованный код — не машина: пока по нему
        не запустились, состояние у него одно и то же. */}
      {machines.length > 0 ? (
        <div className="flex flex-col gap-1">
          {machines.map((bridge) => (
            <State key={bridge.id} bridge={bridge} />
          ))}
        </div>
      ) : null}

      {command ? <Command command={command} copied={copied} onCopy={() => void copy()} /> : null}

      <Outcome answer={answer} failure={failure} />

      {/* Действия прижаты вправо, главное — крайнее справа: взгляд
        заканчивает чтение там же, где его встречает кнопка. */}
      <div className="flex flex-wrap items-center justify-end gap-2 border-line border-t pt-4">
        <Button variant="outline" disabled={issuing} onClick={() => void issue()}>
          {command ? "Новый код" : "Подключить"}
        </Button>
        <Button disabled={checking} onClick={() => void check()}>
          {checking ? "Спрашиваем…" : "Проверить"}
        </Button>
      </div>
    </div>
  );
}
