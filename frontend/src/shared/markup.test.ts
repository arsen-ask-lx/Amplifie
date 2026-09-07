/**
 * Проверки разбора разметки. Быстрые, без стека: разбор — чистая функция.
 *
 * Больше половины проверок здесь про ССЫЛКИ, и это не перекос. React
 * обеззараживает текст, но НЕ атрибуты: `href` со схемой `javascript:`
 * он вставит как есть. Хранимый XSS ровно этим способом нашли
 * в paperclip — одном из продуктов, которые мы разбирали.
 */
import { describe, expect, it } from "vitest";
import { parseMarkup, safeHref, type Token } from "./markup.js";

const kinds = (tokens: Token[]) => tokens.map((t) => t.kind);
const texts = (tokens: Token[]) => tokens.map((t) => t.text);

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
