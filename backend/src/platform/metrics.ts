import { monitorEventLoopDelay } from "node:perf_hooks";

/**
 * Числа, которые сервер рассказывает о себе (task-087).
 *
 * ЗАЧЕМ. Измеритель этого проекта соврал четыре раза за один день, и каждый
 * раз был зелёным: вкладка не догоняла · держатели жили в одном процессе
 * с отправкой · прирост считался счётчиком базы с чужим фоном · вкладка
 * не читала панель. Пока числа даёт только стенд, замер — эксперимент;
 * когда их отдаёт сервер, у любого стенда появляется второй независимый
 * свидетель.
 *
 * ⚠️ БЕЗ НОВОЙ ЗАВИСИМОСТИ, И ЭТО РЕШЕНИЕ, А НЕ ЭКОНОМИЯ. Формат Прометея —
 * это имя, значение и две строки пояснения; всё про железо есть в самом
 * Node (`process.memoryUsage`, `monitorEventLoopDelay`). `prom-client` дал бы
 * то же самое плюс зависимость, которой нужно согласие человека. Порог,
 * на котором вернёмся к нему: метрика, которую руками не собрать, — или
 * двести своих строк здесь.
 *
 * ⚠️ ВОСЕМЬ ЧИСЕЛ, А НЕ ТРИДЦАТЬ. Метрика, которую никто не читает, стоит
 * ровно столько же, сколько метрика, которой нет, — только выглядит работой.
 *
 * ⚠️ ДАТЧИКИ РЕГИСТРИРУЮТ САМИ МОДУЛИ. Иначе вышел бы круг импортов: `db`
 * считает запросы через эти метрики, а метрикам нужен его пул. Здесь только
 * приём чисел, знание о том, что они значат, остаётся у модуля-владельца.
 */

/** Имена счётчиков в одном месте: опечатка в строке не ловится ничем. */
export const COUNTERS = {
  dbQueries: "amplifie_db_queries_total",
  tailHits: "amplifie_tail_hits_total",
  tailMisses: "amplifie_tail_misses_total",
  events: "amplifie_events_total",
  listenerFailures: "amplifie_listener_failures_total",
} as const;

type Counter = (typeof COUNTERS)[keyof typeof COUNTERS];

const HELP: Record<string, string> = {
  [COUNTERS.dbQueries]: "запросов к базе всего",
  [COUNTERS.tailHits]: "догонов, отвеченных из памяти",
  [COUNTERS.tailMisses]: "догонов, ушедших в базу",
  [COUNTERS.events]: "разосланных изменений",
  [COUNTERS.listenerFailures]: "падений слушателей при раздаче",
};

const counters = new Map<Counter, number>();

export function count(name: Counter, by = 1): void {
  counters.set(name, (counters.get(name) ?? 0) + by);
}

/** Датчик — число, которое читается в момент опроса, а не копится. */
interface Gauge {
  help: string;
  read: () => number;
}

const gauges = new Map<string, Gauge>();

export function gauge(name: string, help: string, read: () => number): void {
  gauges.set(name, { help, read });
}

/**
 * Границы гистограммы времени ответа, в секундах.
 *
 * Взяты так, чтобы наши обещания попадали между делениями, а не на край:
 * SLO живых обновлений — 200 мс, порог «медленно» — секунда.
 */
const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.5, 1, 2.5, 5, 10];

interface Door {
  /** Сколько ответов попало в каждую границу и ниже. */
  buckets: number[];
  sum: number;
  n: number;
  /** Ответов по коду: отсюда берётся доля неудачных (Errors из RED). */
  byStatus: Map<number, number>;
}

const doors = new Map<string, Door>();

/**
 * Ответ двери: сколько шёл и чем кончился.
 *
 * Это RED целиком и разом: частота — рост `_count`, доля неудачных — коды,
 * время — гистограмма. Заводить отдельное число под каждую дверь не нужно,
 * и забыть его на новой двери поэтому невозможно.
 */
export function answered(route: string, status: number, seconds: number): void {
  let door = doors.get(route);
  if (!door) {
    door = { buckets: BUCKETS.map(() => 0), sum: 0, n: 0, byStatus: new Map() };
    doors.set(route, door);
  }
  door.sum += seconds;
  door.n += 1;
  door.byStatus.set(status, (door.byStatus.get(status) ?? 0) + 1);
  for (let at = 0; at < BUCKETS.length; at++) {
    const edge = BUCKETS[at];
    if (edge !== undefined && seconds <= edge) door.buckets[at] = (door.buckets[at] ?? 0) + 1;
  }
}

/**
 * Задержка событийного цикла — то самое «насыщение» из USE, которое
 * забывают чаще всего. Растёт раньше, чем что-либо ломается: процессор
 * ещё свободен, а очередь на единственный поток уже стоит.
 *
 * ⚠️ ЗНАЧЕНИЕ — С МОМЕНТА ПРОШЛОГО ОПРОСА. Сбрасывается при чтении, иначе
 * один давний всплеск красил бы график вечно. Цена: два опрашивающих
 * поделят между собой одну картину. У нас опрашивающий один.
 */
const loop = monitorEventLoopDelay({ resolution: 10 });
loop.enable();

function lagSeconds(): number {
  // 0.99, а не среднее: среднее прячет как раз тех, кому плохо.
  const value = loop.percentile(99) / 1e9;
  loop.reset();
  return value;
}

gauge("amplifie_heap_bytes", "занято кучи процессом", () => process.memoryUsage().heapUsed);
gauge("amplifie_event_loop_lag_seconds", "0.99 задержки событийного цикла", lagSeconds);

/** Значение метки: кавычки и косые внутри сломали бы разбор. */
function label(value: string): string {
  return value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"').replace(/\n/gu, " ");
}

function counterLines(): string[] {
  const out: string[] = [];
  for (const [name, help] of Object.entries(HELP)) {
    out.push(`# HELP ${name} ${help}`, `# TYPE ${name} counter`);
    out.push(`${name} ${counters.get(name as Counter) ?? 0}`);
  }
  return out;
}

function gaugeLines(): string[] {
  const out: string[] = [];
  for (const [name, one] of gauges) {
    out.push(`# HELP ${name} ${one.help}`, `# TYPE ${name} gauge`, `${name} ${one.read()}`);
  }
  return out;
}

function doorLines(): string[] {
  const out: string[] = [
    "# HELP amplifie_requests_total ответов двери по коду",
    "# TYPE amplifie_requests_total counter",
  ];
  for (const [route, door] of doors) {
    for (const [status, n] of door.byStatus) {
      out.push(`amplifie_requests_total{route="${label(route)}",status="${status}"} ${n}`);
    }
  }
  out.push(
    "# HELP amplifie_request_seconds за сколько отвечает дверь",
    "# TYPE amplifie_request_seconds histogram",
  );
  for (const [route, door] of doors) {
    const at = `route="${label(route)}"`;
    for (let n = 0; n < BUCKETS.length; n++) {
      out.push(`amplifie_request_seconds_bucket{${at},le="${BUCKETS[n]}"} ${door.buckets[n] ?? 0}`);
    }
    out.push(`amplifie_request_seconds_bucket{${at},le="+Inf"} ${door.n}`);
    out.push(`amplifie_request_seconds_sum{${at}} ${door.sum}`);
    out.push(`amplifie_request_seconds_count{${at}} ${door.n}`);
  }
  return out;
}

/** Всё, что сервер знает о себе, в формате Прометея. */
export function render(): string {
  return [...counterLines(), ...gaugeLines(), ...doorLines()].join("\n").concat("\n");
}
