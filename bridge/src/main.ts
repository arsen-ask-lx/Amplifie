import { cliProvider, KNOWN_CLIENTS, type Provider } from "@amplifie/model";
import { load, type Options, readOptions, save, statePath } from "./settings.js";

/**
 * Мост: машина человека, на которой живёт ЕГО подписка (task-001, Р-012).
 *
 * Соединение открывает эта машина, а не сервер: у ноутбука нет открытого
 * адреса, снаружи к нему не подключиться. Поэтому мост сам приходит
 * за работой и ждёт до 25 секунд — так соединение остаётся живым,
 * не превращаясь в опрос каждую секунду.
 *
 * ⚠️ ТОКЕН ПОДПИСКИ ЗДЕСЬ НЕ ПОЯВЛЯЕТСЯ. Его читает официальный клиент,
 * сам, у себя. Мы передаём клиенту текст вопроса и забираем текст ответа.
 * Именно этим схема и законна: запрос к модели делает та поверхность,
 * которая из запрета исключена.
 *
 * ⚠️ ЧТО ЗАПУСКАТЬ, РЕШАЕТ ЭТА МАШИНА. Сервер присылает только текст.
 * Иначе он диктовал бы чужим ноутбукам, какую программу выполнить.
 */

/** Сколько ждём, прежде чем прийти за работой снова после обрыва. */
const RETRY_MS = 3000;

interface Job {
  jobId: string;
  system: string;
  prompt: string;
}

function say(line: string): void {
  console.log(`${new Date().toLocaleTimeString("ru")} ${line}`);
}

/** Клиент, которым будем спрашивать. Список общий с сервером. */
function clientOf(options: Options): Provider {
  const known = KNOWN_CLIENTS[options.client];
  if (!known) {
    const knownNames = Object.keys(KNOWN_CLIENTS).join(", ");
    throw new Error(`неизвестный клиент «${options.client}». Годятся: ${knownNames}`);
  }
  return cliProvider({
    name: options.client,
    command: options.command || known.command,
    args: known.args,
    timeoutMs: options.timeoutMs,
  });
}

/**
 * Сервер не признал мост. Повтор не поможет — ключ отозван или база
 * стёрта, — поэтому это отказ всего моста, а не обрыв связи.
 */
class NotRecognized extends Error {}

async function connect(options: Options): Promise<{ token: string; name: string }> {
  /**
   * ⚠️ КОД В СТРОКЕ ВАЖНЕЕ СОХРАНЁННОГО. Строку с кодом запускают, чтобы
   * подключиться ЗАНОВО. Прежде сохранённое подключение к тому же адресу
   * побеждало, код молча пропускался, и мост вечно стучался старым ключом,
   * который сервер уже не признавал (владелец, 11.09).
   */
  if (!options.code) {
    const saved = load();
    // Уже подключались к этому же пространству — код не нужен.
    if (saved && saved.url === options.url) return { token: saved.token, name: saved.name };
    throw new Error(
      "нужен код подключения: на сайте, «Подключить свою нейросеть», скопируйте\n" +
        "строку запуска целиком — в ней уже есть и адрес, и код",
    );
  }

  const response = await fetch(`${options.url}/v1/bridge/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: options.code, name: options.name }),
  });

  if (response.status === 404) {
    throw new Error("код не подошёл: он одноразовый и живёт 15 минут. Возьмите новый на сайте");
  }
  if (!response.ok) {
    throw new Error(`подключение не удалось: сервер ответил ${response.status}`);
  }

  const { token } = (await response.json()) as { token: string };
  save({ url: options.url, token, name: options.name });
  say(`подключён как «${options.name}», токен сохранён в ${statePath()}`);
  return { token, name: options.name };
}

/** Забрать задание. `null` — работы не было, это нормальный исход. */
async function takeJob(options: Options, token: string): Promise<Job | null> {
  const response = await fetch(`${options.url}/v1/bridge/next`, {
    headers: { authorization: `Bridge ${token}` },
  });
  if (response.status === 204) return null;
  if (response.status === 401) {
    throw new NotRecognized(
      "сервер не признал этот мост. Возьмите на сайте новую строку запуска и запустите её",
    );
  }
  if (!response.ok) throw new Error(`сервер ответил ${response.status}`);
  return (await response.json()) as Job;
}

async function sendBack(
  options: Options,
  token: string,
  jobId: string,
  result: { text: string } | { error: string },
): Promise<void> {
  const response = await fetch(`${options.url}/v1/bridge/answer`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bridge ${token}` },
    body: JSON.stringify({ jobId, ...result }),
  });
  if (!response.ok) {
    // Ответ не доехал — вопрос у человека выйдет по сроку. Молчать нельзя:
    // это единственное место, где видно, что работа сделана впустую.
    say(`ответ не доехал: сервер ${response.status}`);
    return;
  }
  const { outcome } = (await response.json()) as { outcome: string };
  if (outcome === "никто-не-ждал") say("ответ никому не достался: у спросившего вышел срок");
}

/** Один вопрос: спросить клиента и вернуть, что вышло. */
async function handle(client: Provider, job: Job): Promise<{ text: string } | { error: string }> {
  const started = Date.now();
  say(`вопрос ${job.jobId.slice(0, 8)} — спрашиваю ${client.name}`);
  try {
    const answer = await client.ask({ system: job.system, prompt: job.prompt });
    say(`вопрос ${job.jobId.slice(0, 8)} — ответ за ${Date.now() - started} мс`);
    return { text: answer.text };
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    say(`вопрос ${job.jobId.slice(0, 8)} — отказ за ${Date.now() - started} мс: ${why}`);
    // Причина уходит человеку: он единственный, кто может её починить —
    // установить клиент, войти в него, включить сеть.
    return { error: why };
  }
}

/** Один оборот: прийти за работой, сделать её, вернуть ответ. */
async function serveOnce(options: Options, token: string, client: Provider): Promise<void> {
  try {
    const job = await takeJob(options, token);
    if (job) await sendBack(options, token, job.jobId, await handle(client, job));
  } catch (error) {
    if (error instanceof NotRecognized) throw error;
    const why = error instanceof Error ? error.message : String(error);
    // Сеть моргнула, сервер перезапускается — обычное дело. Но тихо
    // крутиться в пустом цикле нельзя: человек должен видеть причину.
    say(`нет связи: ${why}. Повтор через ${RETRY_MS / 1000} с`);
    await new Promise((wake) => setTimeout(wake, RETRY_MS));
  }
}

async function run(): Promise<void> {
  const options = readOptions();
  const client = clientOf(options);
  const { token, name } = await connect(options);

  say(`мост «${name}» на связи с ${options.url}, клиент ${options.client}`);
  say("оставьте это окно открытым. Закроете — модель перестанет отвечать");

  for (;;) await serveOnce(options, token, client);
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
