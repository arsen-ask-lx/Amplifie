/**
 * Проверки сверки «план заявил — агент сделал» (task-109).
 *
 * ⚠️ ЗАПИСЬ СЕССИИ ЗДЕСЬ ВЫДУМАННАЯ, НО ФОРМА — НАСТОЯЩАЯ. Каждое поле
 * взято из живой записи Claude Code (21.09): `tool_use` у помощника,
 * `toolUseResult.file` с `startLine/numLines/totalLines` у ответа на чтение.
 * Настоящая запись весит сотни мегабайт и меняется каждую минуту — гонять
 * правило по ней значило бы проверять погоду, а не правило.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { claimsIn, claimTime, coverageOf, criticRan, readsFrom, verdict } from "./trace-rules.mjs";

let clock = 0;
const at = () => new Date(Date.UTC(2026, 8, 21, 12, 0, clock++)).toISOString();

/** Вызов инструмента помощником и ответ на него — две строки записи, как в жизни. */
function call(name, input, result) {
  const id = `toolu_${clock}`;
  const asked = {
    type: "assistant",
    isSidechain: false,
    timestamp: at(),
    message: { content: [{ type: "tool_use", id, name, input }] },
  };
  const answered = {
    type: "user",
    isSidechain: false,
    timestamp: at(),
    message: { content: [{ type: "tool_result", tool_use_id: id }] },
    ...(result ? { toolUseResult: result } : {}),
  };
  return [asked, answered];
}

const read = (path, startLine, numLines, totalLines) =>
  call(
    "Read",
    { file_path: path },
    { type: "text", file: { filePath: path, startLine, numLines, totalLines } },
  );
const bash = (command) => call("Bash", { command }, { stdout: "" });
const write = (path, content) => call("Write", { file_path: path, content }, { type: "create" });

const lines = {
  "backend/src/kernel/talk/service.ts": 900,
  "backend/src/kernel/identity/service.ts": 300,
  "frontend/src/data/readMarks.ts": 180,
};
/** Сколько строк «на диске»: файл ищется по концу пути, как у настоящего запуска из папки файла. */
const linesOf = (path) =>
  lines[Object.keys(lines).find((one) => one.endsWith(path) || path.endsWith(one)) ?? ""] ?? null;

describe("что открыто: чтение инструментом", () => {
  it("чтение целиком — все строки", () => {
    const events = readsFrom(
      read("E:\\Amplifie\\frontend\\src\\data\\readMarks.ts", 1, 180, 180).flat(),
    );
    const seen = coverageOf(events, linesOf);
    const { ranges, total } = [...seen.values()][0];
    assert.deepEqual({ ranges, total }, { ranges: [[1, 180]], total: 180 });
  });

  it("два куска, покрывающие файл, складываются в целиком", () => {
    const events = readsFrom([
      ...read("E:/Amplifie/frontend/src/data/readMarks.ts", 1, 80, 180),
      ...read("E:/Amplifie/frontend/src/data/readMarks.ts", 81, 100, 180),
    ]);
    const rows = verdict(
      claimsIn("| `frontend/src/data/readMarks.ts` | 180 | целиком |"),
      coverageOf(events, linesOf),
    );
    assert.equal(rows[0].status, "целиком");
  });

  it("первые восемьдесят строк из ста восьмидесяти — частично", () => {
    const events = readsFrom(read("E:/Amplifie/frontend/src/data/readMarks.ts", 1, 80, 180));
    const rows = verdict(
      claimsIn("| `readMarks.ts` | 180 | целиком |"),
      coverageOf(events, linesOf),
    );
    assert.equal(rows[0].status, "частично");
    assert.equal(rows[0].seen, 80);
  });
});

describe("что открыто: команды оболочки", () => {
  it("cat файла — целиком, по числу строк на диске", () => {
    const events = readsFrom(bash("cd /e/Amplifie && cat backend/src/kernel/talk/service.ts"));
    const rows = verdict(claimsIn("| `service.ts` | 900 | целиком |"), coverageOf(events, linesOf));
    assert.equal(rows[0].status, "целиком");
  });

  it("sed -n диапазоном — только диапазон", () => {
    const events = readsFrom(bash("sed -n '225,270p' backend/src/kernel/talk/service.ts"));
    const seen = coverageOf(events, linesOf);
    assert.deepEqual([...seen.values()][0].ranges, [[225, 270]]);
  });

  it("head — начало файла", () => {
    const events = readsFrom(bash("head -80 frontend/src/data/readMarks.ts"));
    assert.deepEqual([...coverageOf(events, linesOf).values()][0].ranges, [[1, 80]]);
  });

  it("grep по файлу — не чтение: строк не открыто", () => {
    const events = readsFrom(bash('grep -n "markRead" -A40 backend/src/kernel/talk/service.ts'));
    const rows = verdict(claimsIn("| `service.ts` | 900 | целиком |"), coverageOf(events, linesOf));
    assert.equal(rows[0].status, "не открыт");
  });

  it("cat в конвейере с head — не целиком", () => {
    const events = readsFrom(bash("cat frontend/src/data/readMarks.ts | head -30"));
    const rows = verdict(
      claimsIn("| `readMarks.ts` | 180 | целиком |"),
      coverageOf(events, linesOf),
    );
    assert.notEqual(rows[0].status, "целиком");
  });
});

describe("что заявлено", () => {
  it("таблица «Прочитано»: проверяются только строки «целиком»", () => {
    const plan = [
      "### Прочитано",
      "",
      "| файл | строк | как |",
      "|---|---|---|",
      "| `a/one.ts` | 10 | целиком |",
      "| `a/two.ts` | 20 | фрагмент (1–5) |",
    ].join("\n");
    assert.deepEqual(
      claimsIn(plan).map((one) => one.file),
      ["a/one.ts"],
    );
  });

  it("старая форма «Прочитано целиком:» — имена файлов, а не функций", () => {
    const plan =
      "Прочитано целиком: `useReading.ts`, `readMarks.ts` (+ тест), `unread.ts`,\n" +
      "`service.ts` (`markRead`), `platform/db.ts` (счётчик\n`x-db-queries`), `measure.mjs`.\n\nДальше текст.";
    assert.deepEqual(
      claimsIn(plan).map((one) => one.file),
      ["useReading.ts", "readMarks.ts", "unread.ts", "service.ts", "platform/db.ts", "measure.mjs"],
    );
  });
});

describe("упоминание — не заявление", () => {
  it("«Прочитано целиком:» в середине фразы — это рассказ о форме, а не заявление", () => {
    // Живой случай 21.09: план task-109 описывал старую форму словами, и первая
    // редакция правила приняла пример за три заявления.
    const plan =
      "- `claimsIn` — и старая форма «Прочитано целиком: `a.ts`, `b.ts`» (для старых планов);";
    assert.deepEqual(claimsIn(plan), []);
  });
});

describe("когда заявлено", () => {
  it("сверяется с тем, что было открыто ДО записи плана, а не после", () => {
    const records = [
      ...read("E:/Amplifie/frontend/src/data/readMarks.ts", 1, 80, 180),
      ...write("E:\\Amplifie\\dock\\tasks\\task-900-x.md", "Прочитано целиком: `readMarks.ts`."),
      ...read("E:/Amplifie/frontend/src/data/readMarks.ts", 81, 100, 180),
    ];
    const until = claimTime(records, "task-900");
    const rows = verdict(
      claimsIn("Прочитано целиком: `readMarks.ts`."),
      coverageOf(readsFrom(records, until), linesOf),
    );
    assert.equal(rows[0].status, "частично");
  });

  it("чтение подагентом не засчитывается автору", () => {
    const [asked, answered] = read("E:/Amplifie/frontend/src/data/readMarks.ts", 1, 180, 180);
    const events = readsFrom([
      { ...asked, isSidechain: true },
      { ...answered, isSidechain: true },
    ]);
    assert.equal(events.length, 0);
  });
});

describe("неоднозначное имя", () => {
  it("два разных файла с одним именем и ни один не прочитан целиком — неоднозначно", () => {
    const events = readsFrom([
      ...read("E:/Amplifie/backend/src/kernel/talk/service.ts", 1, 50, 900),
      ...read("E:/Amplifie/backend/src/kernel/identity/service.ts", 1, 50, 300),
    ]);
    const rows = verdict(claimsIn("| `service.ts` | 900 | целиком |"), coverageOf(events, linesOf));
    assert.equal(rows[0].status, "неоднозначно");
  });

  it("один из одноимённых прочитан, другой нет — всё равно неоднозначно: за автора не выбираем", () => {
    // Живой случай 21.09: план task-108 назвал `service.ts`, имея в виду
    // `talk/service.ts` на 905 строк, а засчитался `identity/service.ts`.
    const events = readsFrom([
      ...read("E:/Amplifie/backend/src/kernel/talk/service.ts", 1, 50, 900),
      ...read("E:/Amplifie/backend/src/kernel/identity/service.ts", 1, 300, 300),
    ]);
    const rows = verdict(claimsIn("| `service.ts` | 900 | целиком |"), coverageOf(events, linesOf));
    assert.equal(rows[0].status, "неоднозначно");
  });

  it("полный путь снимает неоднозначность", () => {
    const events = readsFrom([
      ...read("E:/Amplifie/backend/src/kernel/talk/service.ts", 1, 900, 900),
      ...read("E:/Amplifie/backend/src/kernel/identity/service.ts", 1, 10, 300),
    ]);
    const plan = "| `backend/src/kernel/talk/service.ts` | 900 | целиком |";
    assert.equal(verdict(claimsIn(plan), coverageOf(events, linesOf))[0].status, "целиком");
  });
});

describe("файл, которого больше нет", () => {
  it("прочитанный по старому пути засчитан не будет", () => {
    // Живой случай 21.09: `platform/db.ts` засчитался по `apps/api/...` —
    // чтению двухнедельной давности, до переезда кода в `backend/`.
    const events = readsFrom(read("E:/Amplifie/apps/api/src/platform/db.ts", 1, 44, 44));
    const rows = verdict(
      claimsIn("| `platform/db.ts` | 44 | целиком |"),
      coverageOf(events, linesOf),
    );
    assert.equal(rows[0].status, "файла нет");
  });

  it("короткий путь из папки файла и полный путь — один файл, а не два", () => {
    const events = readsFrom([
      ...read("E:/Amplifie/frontend/src/data/readMarks.ts", 1, 80, 180),
      ...bash("cd frontend/src/data && sed -n '81,180p' readMarks.ts"),
    ]);
    const rows = verdict(
      claimsIn("| `readMarks.ts` | 180 | целиком |"),
      coverageOf(events, linesOf),
    );
    assert.equal(rows[0].status, "целиком");
  });
});

describe("куски разных версий не складываются", () => {
  // Живой случай 21.09: `talk/service.ts` ни разу не читался целиком —
  // сорок три `sed -n` кусками за две недели, пока файл менялся, — а первая
  // редакция правила сложила их в «целиком».
  it("файл стал длиннее — прежние куски не в счёт", () => {
    const events = readsFrom([
      ...read("E:/Amplifie/frontend/src/data/readMarks.ts", 1, 100, 150),
      ...read("E:/Amplifie/frontend/src/data/readMarks.ts", 101, 80, 180),
    ]);
    const rows = verdict(
      claimsIn("| `readMarks.ts` | 180 | целиком |"),
      coverageOf(events, linesOf),
    );
    assert.equal(rows[0].status, "частично");
    assert.equal(rows[0].seen, 80);
  });

  it("правка файла агентом — прочитанное до неё не в счёт", () => {
    const events = readsFrom([
      ...read("E:/Amplifie/frontend/src/data/readMarks.ts", 1, 180, 180),
      ...call(
        "Edit",
        {
          file_path: "E:/Amplifie/frontend/src/data/readMarks.ts",
          old_string: "a",
          new_string: "b",
        },
        {},
      ),
    ]);
    const rows = verdict(
      claimsIn("| `readMarks.ts` | 180 | целиком |"),
      coverageOf(events, linesOf),
    );
    assert.equal(rows[0].status, "не открыт");
  });

  it("давнее чтение — старше окна до заявления — не в счёт", () => {
    const records = [
      ...read("E:/Amplifie/frontend/src/data/readMarks.ts", 1, 180, 180),
      ...write("E:/Amplifie/dock/tasks/task-900-x.md", "Прочитано целиком: `readMarks.ts`."),
    ];
    const until = claimTime(records, "task-900");
    // Окно в полсекунды: чтение было за секунду до заявления — значит вне окна.
    const events = readsFrom(records, until, until - 500);
    assert.equal(events.length, 0);
  });
});

describe("когда прочитано", () => {
  it("вердикт называет время последнего чтения — давнее чтение видно глазами", () => {
    const events = readsFrom(read("E:/Amplifie/frontend/src/data/readMarks.ts", 1, 180, 180));
    const rows = verdict(
      claimsIn("| `readMarks.ts` | 180 | целиком |"),
      coverageOf(events, linesOf),
    );
    assert.equal(typeof rows[0].lastAt, "number");
  });
});

/*
 * Дыры, найденные первым разбором критика (task-109, 21.09). Каждая —
 * подсаженным случаем: гейт, который ни разу не краснел на своей дыре,
 * неотличим от гейта без неё.
 */

/** Команда оболочки, чей вывод Claude Code обрезал до превью. */
function truncatedBash(command) {
  const [asked, answered] = bash(command);
  answered.message.content[0].truncated = true;
  return [asked, answered];
}

describe("разбор критика: обрезанный вывод", () => {
  it("cat, чей вывод обрезан до превью, — не чтение целиком", () => {
    const events = readsFrom(truncatedBash("cat frontend/src/data/readMarks.ts"));
    const rows = verdict(
      claimsIn("| `readMarks.ts` | 180 | целиком |"),
      coverageOf(events, linesOf),
    );
    assert.equal(rows[0].status, "не открыт");
  });
});

describe("разбор критика: PowerShell", () => {
  it("Get-Content файла — целиком", () => {
    const records = call(
      "PowerShell",
      { command: "Get-Content frontend/src/data/readMarks.ts" },
      {},
    );
    const rows = verdict(
      claimsIn("| `readMarks.ts` | 180 | целиком |"),
      coverageOf(readsFrom(records), linesOf),
    );
    assert.equal(rows[0].status, "целиком");
  });

  it("Get-Content -TotalCount 50 — начало", () => {
    const records = call(
      "PowerShell",
      { command: "Get-Content frontend/src/data/readMarks.ts -TotalCount 50" },
      {},
    );
    assert.deepEqual([...coverageOf(readsFrom(records), linesOf).values()][0].ranges, [[1, 50]]);
  });
});

describe("разбор критика: момент заявления", () => {
  it("правка плана со словом «прочитано», но без строк «целиком», момент не сдвигает", () => {
    const records = [
      ...write("E:/Amplifie/dock/tasks/task-900-x.md", "| `a.ts` | 10 | целиком |"),
      ...call(
        "Edit",
        { file_path: "E:/Amplifie/dock/tasks/task-900-x.md", new_string: "всё прочитано, спасибо" },
        {},
      ),
    ];
    const claimed = claimTime(records, "task-900");
    assert.equal(claimed, Date.parse(records[0].timestamp));
  });

  it("правка, дописавшая строку «целиком» без слова «прочитано», — это заявление", () => {
    const records = [
      ...write("E:/Amplifie/dock/tasks/task-900-x.md", "# план"),
      ...call(
        "Edit",
        {
          file_path: "E:/Amplifie/dock/tasks/task-900-x.md",
          new_string: "| `b.ts` | 5 | целиком |",
        },
        {},
      ),
    ];
    assert.equal(claimTime(records, "task-900"), Date.parse(records[2].timestamp));
  });
});

describe("разбор критика: был ли критик", () => {
  const plan = write("E:/Amplifie/dock/tasks/task-900-x.md", "| `a.ts` | 10 | целиком |");
  const critic = (prompt) => call("Agent", { subagent_type: "plan-critic", prompt }, {});

  it("критик позван после заявления и по этому плану — был", () => {
    const records = [...plan, ...critic("Разбери план task-900")];
    assert.equal(criticRan(records, "task-900", claimTime(records, "task-900")), true);
  });

  it("критика не звали — строка «Замечаний нет» его не заменит", () => {
    const records = [...plan];
    assert.equal(criticRan(records, "task-900", claimTime(records, "task-900")), false);
  });

  it("критик по другому плану — не в счёт", () => {
    const records = [...plan, ...critic("Разбери план task-901")];
    assert.equal(criticRan(records, "task-900", claimTime(records, "task-900")), false);
  });
});
