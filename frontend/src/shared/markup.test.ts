/**
 * Проверки разбора разметки. Быстрые, без стека: разбор — чистая функция.
 *
 * Больше половины проверок здесь про ССЫЛКИ, и это не перекос. React
 * обеззараживает текст, но НЕ атрибуты: `href` со схемой `javascript:`
 * он вставит как есть. Хранимый XSS ровно этим способом нашли
 * в paperclip — одном из продуктов, которые мы разбирали.
 */
import { describe, expect, it } from "vitest";
import { parseMarkup, plain, safeHref, type Token } from "./markup.js";

const kinds = (tokens: Token[]) => tokens.map((t) => t.kind);
/**
 * ⚠️ ЧИТАЕТ ДЕРЕВО, А НЕ ПОЛЕ. Обёртки после task-021 держат детей,
 * а не строку: `**жирный *курсив***` — это жирный, внутри которого
 * курсив. Ожидания в проверках от этого не изменились ни на знак,
 * изменился только способ добраться до текста.
 */
const texts = (tokens: Token[]) => tokens.map(plain);

describe("ссылка", () => {
  it("пропускает только http и https", () => {
    expect(safeHref("https://example.com/a")).toBe("https://example.com/a");
    expect(safeHref("http://example.com")).toBe("http://example.com/");
  });

  it.each([
    ["javascript:alert(1)", "схема исполняемого кода"],
    ["JavaScript:alert(1)", "она же с заглавными"],
    ["  javascript:alert(1)", "она же с пробелом впереди"],
    ["java\tscript:alert(1)", "она же с табуляцией внутри"],
    ["vbscript:msgbox(1)", "старая исполняемая схема"],
    ["data:text/html;base64,PHNjcmlwdD4=", "встроенный документ"],
    ["file:///etc/passwd", "файл на машине"],
    ["/относительная", "относительный путь"],
    ["не адрес вовсе", "просто текст"],
  ])("отвергает %s — %s", (raw) => {
    expect(safeHref(raw)).toBeNull();
  });

  it("негодную ссылку показывает текстом, а не выбрасывает", () => {
    // Человек это написал и обязан увидеть, что именно он написал.
    const tokens = parseMarkup("жми [сюда](javascript:alert(1))");
    expect(kinds(tokens)).not.toContain("link");
    expect(texts(tokens).join("")).toContain("сюда");
  });

  it("ссылка с подписью разбирается", () => {
    const tokens = parseMarkup("см. [доки](https://example.com/docs) там");
    expect(kinds(tokens)).toEqual(["text", "link", "text"]);
    const link = tokens[1];
    expect(link).toMatchObject({ kind: "link", text: "доки", href: "https://example.com/docs" });
  });

  it("голый адрес становится ссылкой", () => {
    const tokens = parseMarkup("тут https://example.com/x и всё");
    expect(kinds(tokens)).toEqual(["text", "link", "text"]);
  });

  it("точка в конце предложения не уезжает в адрес", () => {
    const tokens = parseMarkup("см. https://example.com/a.");
    const link = tokens.find((t) => t.kind === "link");
    expect(link?.text).toBe("https://example.com/a");
    expect(texts(tokens).join("")).toContain(".");
  });
});

describe("выделение", () => {
  it("жирный, курсив и код", () => {
    expect(kinds(parseMarkup("**ж** и *к* и `код`"))).toEqual([
      "bold",
      "text",
      "italic",
      "text",
      "code",
    ]);
  });

  it("внутри кода разметка не работает", () => {
    // Иначе нельзя показать сам синтаксис, а в рабочей переписке
    // показывают его постоянно.
    const tokens = parseMarkup("`**не жирный**`");
    expect(kinds(tokens)).toEqual(["code"]);
    expect(texts(tokens)).toEqual(["**не жирный**"]);
  });

  it("одиночная звёздочка остаётся звёздочкой", () => {
    expect(kinds(parseMarkup("2 * 3 = 6"))).toEqual(["text"]);
  });

  it("подчёркивание не курсив — иначе рвутся имена_переменных", () => {
    const tokens = parseMarkup("поле user_name_id");
    expect(kinds(tokens)).toEqual(["text"]);
    expect(texts(tokens)).toEqual(["поле user_name_id"]);
  });

  it("незакрытая разметка остаётся текстом", () => {
    expect(kinds(parseMarkup("**без пары"))).toEqual(["text"]);
  });

  /**
   * Виды, добавленные вслед за Телеграмом. Проверяются по одному, потому
   * что ломается тут не разбор, а ПОРЯДОК веток в регулярке: длинная
   * обёртка обязана стоять раньше короткой.
   */
  it("подчёркнутый, зачёркнутый и скрытый — каждый своим видом", () => {
    expect(kinds(parseMarkup("__низ__"))).toEqual(["underline"]);
    expect(kinds(parseMarkup("~~вон~~"))).toEqual(["strike"]);
    expect(kinds(parseMarkup("||тсс||"))).toEqual(["spoiler"]);
    expect(texts(parseMarkup("__низ__"))).toEqual(["низ"]);
  });

  it("блок кода разбирается раньше одинарной кавычки", () => {
    const tokens = parseMarkup("```\nconst a = 1;\n```");
    // Если бы ветки стояли в другом порядке, тут вышло бы три куска
    // по одной кавычке вместо одного блока.
    expect(kinds(tokens)).toEqual(["pre"]);
    expect(texts(tokens)).toEqual(["const a = 1;\n"]);
  });

  it("жирный разбирается раньше курсива", () => {
    expect(kinds(parseMarkup("**оба**"))).toEqual(["bold"]);
    expect(kinds(parseMarkup("*один*"))).toEqual(["italic"]);
  });

  it("одинарное подчёркивание по-прежнему не курсив", () => {
    // Расхождение с Телеграмом, названное в самом разборщике: имена
    // с подчёркиваниями в рабочей переписке частотнее курсива.
    expect(kinds(parseMarkup("поле user_name_id"))).toEqual(["text"]);
  });
});

describe("целость текста", () => {
  it("склейка кусков даёт исходный текст, если разметки нет", () => {
    const body = "обычная строка\nсо второй строкой";
    expect(texts(parseMarkup(body)).join("")).toBe(body);
  });

  it("пустое сообщение не роняет разбор", () => {
    expect(parseMarkup("")).toEqual([]);
  });

  it("переводы строк сохраняются", () => {
    expect(texts(parseMarkup("раз\n\nдва")).join("")).toBe("раз\n\nдва");
  });
});

/**
 * ВЛОЖЕННОСТЬ (Р-028, task-021).
 *
 * ⚠️ ЭТО ПОЧИНКА, А НЕ НОВАЯ ВОЗМОЖНОСТЬ. Поле умело накладывать два вида
 * на один кусок с самого начала — а разборщик такую строку прочесть не мог,
 * и обёртка вылезала в ленту буквами. Владелец поймал это на моноширинном:
 * `**`код`**` показывался жирным словом в кавычках.
 */
describe("вложенность", () => {
  it("курсив внутри жирного остаётся курсивом, а не звёздочками", () => {
    const tokens = parseMarkup("**жирный *курсив* внутри**");
    expect(kinds(tokens)).toEqual(["bold"]);
    const bold = tokens[0];
    if (bold === undefined || !("children" in bold)) throw new Error("жирный без детей");
    expect(kinds(bold.children)).toEqual(["text", "italic", "text"]);
    // Ни одной звёздочки на экране — ради этого всё и делается.
    expect(texts(tokens).join("")).toBe("жирный курсив внутри");
  });

  it("подчёркнутый внутри жирного", () => {
    const tokens = parseMarkup("**__оба сразу__**");
    expect(kinds(tokens)).toEqual(["bold"]);
    const bold = tokens[0];
    if (bold === undefined || !("children" in bold)) throw new Error("жирный без детей");
    expect(kinds(bold.children)).toEqual(["underline"]);
  });

  it("жирный и курсив разом уезжают тройной звёздочкой", () => {
    // ⚠️ У ЭТОЙ ПАРЫ СВОЯ ВЕТКА, И БЕЗ НЕЁ СТРОКА ЧИТАЕТСЯ ДВОЯКО:
    // `**` + `*x*` + `**` неотличимо от `*` + `**x**` + `*`. Телеграм
    // советует разделять такие пары пустой сущностью — мы вместо этого
    // читаем тройку целиком (Р-028).
    const tokens = parseMarkup("***и то и то***");
    expect(kinds(tokens)).toEqual(["bold"]);
    const bold = tokens[0];
    if (bold === undefined || !("children" in bold)) throw new Error("жирный без детей");
    expect(kinds(bold.children)).toEqual(["italic"]);
    expect(texts(tokens)).toEqual(["и то и то"]);
  });

  it("моноширинный внутри жирного не разбирается — кавычки это буквы", () => {
    // Обратная сторона запрета из Р-028: совмещать нельзя, значит внутри
    // жирного кавычка остаётся кавычкой, а не открывает моноширинный.
    // Строку такого вида поле больше не производит — но накопленные
    // сообщения с ней существуют, и показать их надо предсказуемо.
    const tokens = parseMarkup("**жирный `код` внутри**");
    expect(kinds(tokens)).toEqual(["bold"]);
    const bold = tokens[0];
    if (bold === undefined || !("children" in bold)) throw new Error("жирный без детей");
    expect(kinds(bold.children)).toEqual(["text", "code", "text"]);
  });

  it("три вида друг в друге", () => {
    const tokens = parseMarkup("~~**__всё сразу__**~~");
    expect(kinds(tokens)).toEqual(["strike"]);
    expect(texts(tokens)).toEqual(["всё сразу"]);
  });

  it("тысяча звёздочек не кладёт вкладку", () => {
    // ⚠️ ПРЕДЕЛ ГЛУБИНЫ — НЕ ПЕРЕСТРАХОВКА. Разбор рекурсивный, и строка,
    // которую ничего не мешает прислать, переполнила бы стек.
    const края = "**".repeat(1000);
    const кривая = `${края}дно${края}`;
    expect(() => parseMarkup(кривая)).not.toThrow();
  });
});
