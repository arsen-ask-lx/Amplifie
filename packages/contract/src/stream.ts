/**
 * Протокол потока живых обновлений `/v1/stream`: как его читать и как
 * к нему возвращаться (task-093).
 *
 * ⚠️ ОДНО МЕСТО НА КЛИЕНТА И НА ПРИБОР НАГРУЗКИ. Прибор держал свою копию
 * поведения клиента, и копии расходились шесть раз (task-091): резал поток
 * по кускам сокета, догонял там, где браузер не догонял. Здесь чистые
 * функции без зависимостей — их берут и `frontend`, и `tools/load`.
 */

/** Событие потока: имя (`event:`) и данные (`data:`). */
export interface StreamEvent {
  name: string;
  data: string;
}

/**
 * Нарезать прочитанное на законченные события с данными.
 *
 * Кусок из сокета — не событие: под нагрузкой в один `read()` приезжают два
 * события сразу или половина одного. `rest` — недочитанный хвост, его
 * приклеивают к следующему куску.
 *
 * Разделитель — пустая строка `\n\n`: так пишет наш сервер
 * (`routes/stream.ts`). `\r\n` из спецификации SSE не разбирается — поток
 * говорит только с нашим сервером.
 */
export function framed(buffer: string): { events: string[]; rest: string } {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  return { events: parts.filter((one) => one.includes("data:")), rest };
}

/**
 * Разобрать одно событие по правилам SSE (WHATWG): `event:` задаёт имя,
 * по умолчанию `message`; несколько `data:` склеиваются переводом строки;
 * строка с двоеточием в начале — комментарий. Нет данных — не событие.
 */
export function eventOf(block: string): StreamEvent | null {
  let name = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    const { field, value } = fieldOf(line);
    if (field === "event") name = value;
    else if (field === "data") data.push(value);
  }
  return data.length === 0 ? null : { name, data: data.join("\n") };
}

/**
 * Строка события: поле до первого двоеточия, значение после него без одного
 * ведущего пробела. Комментарий (двоеточие первым) — пустое поле.
 */
function fieldOf(line: string): { field: string; value: string } {
  const colon = line.indexOf(":");
  if (colon === 0) return { field: "", value: "" };
  if (colon === -1) return { field: line, value: "" };
  const raw = line.slice(colon + 1);
  return { field: line.slice(0, colon), value: raw.startsWith(" ") ? raw.slice(1) : raw };
}

/**
 * Окно переподключения: секунда на первую попытку, вдвое на каждую
 * следующую, не больше тридцати секунд.
 *
 * Тридцать — не красота, а компромисс: меньше — после выкладки тысячи
 * вкладок стучатся слишком часто; больше — после короткого обрыва человек
 * ждёт обновлений заметно долго.
 */
export const RECONNECT = { baseMs: 1_000, capMs: 30_000 } as const;

/**
 * Сколько ждать перед попыткой номер `attempt` (с нуля).
 *
 * ⚠️ ПОЛНЫЙ РАЗБРОС, А НЕ «РОВНО N СЕКУНД». Браузер у `EventSource`
 * переподключает все вкладки через одинаковые ~3 с — после выкладки это
 * три тысячи подключений в одну секунду. Случайная задержка от нуля
 * до окна гасит такой пик лучше всего (AWS, Exponential Backoff and Jitter).
 *
 * `floorMs` — срок, названный сервером (`Retry-After`). Разброс идёт ПОВЕРХ
 * него: иначе все, кому сказали «через пять секунд», вернулись бы ровно
 * через пять секунд одной толпой.
 */
export function nextDelay(attempt: number, random: () => number, floorMs = 0): number {
  const window = Math.min(RECONNECT.capMs, RECONNECT.baseMs * 2 ** Math.max(0, attempt));
  // Срок у самой границы таймера плюс разброс перевалил бы за неё — и тот же ноль.
  return Math.min(TIMER_MAX_MS, Math.max(0, floorMs) + Math.floor(random() * window));
}

/**
 * `Retry-After` в миллисекундах: секунды либо дата HTTP. Нет заголовка,
 * мусор или дата в прошлом — ноль: срок сервера только добавляет ожидание,
 * но не отменяет разброс.
 */
export function retryAfterMs(header: string | null, now: number): number {
  if (header === null) return 0;
  const trimmed = header.trim();
  if (/^\d+$/u.test(trimmed)) return Math.min(TIMER_MAX_MS, Number(trimmed) * 1_000);
  const at = Date.parse(trimmed);
  return Number.isNaN(at) ? 0 : Math.min(TIMER_MAX_MS, Math.max(0, at - now));
}

/**
 * Дольше таймер браузера не держит: 2³¹−1 мс. Срок больше этого `setTimeout`
 * понимает как ноль — и переподключение шло БЕЗ паузы, ровно наоборот тому,
 * о чём просил сервер (найдено проверкой свойств, task-121).
 */
const TIMER_MAX_MS = 2_147_483_647;
