/**
 * ПРОВЕРКИ СЛИЯНИЯ ДОГОНА В ЛЕНТУ (change `chat-edit-delete-sync`).
 *
 * ⚠️ ПРОВЕРЯЕТСЯ РОВНО ТО, ЧТО НАЗВАНО РИСКОМ В УСТРОЙСТВЕ: догон теперь
 * может принести реплику, которая у клиента уже есть. Раньше он приносил
 * только новое, и «дописать в конец» было верно; теперь дописывание
 * задваивало бы исправленную реплику. Задвоение — из тех поломок, что
 * видно только глазами и только у второго человека, поэтому здесь
 * не рассуждение, а арбитр.
 */
import { describe, expect, it } from "vitest";
import type { Message, SyncLine, Tombstone } from "./api.js";
import { inside, merge, mergePinned, ofRoom, writtenEdge } from "./feed.js";
import { TEST_ROOM, testLine } from "./feedLines.js";

const ROOM = TEST_ROOM;
const line = testLine;

const grave = (id: string, seq: number): Tombstone => ({
  id,
  conversationId: ROOM,
  seq,
  deleted: true,
});

describe("слияние догона в ленту", () => {
  it("новая реплика дописывается", () => {
    const got = merge([line("a", 1, "раз")], [line("b", 2, "два")]);
    expect(got.map((m) => m.body)).toEqual(["раз", "два"]);
  });

  it("исправленная реплика замещает прежнюю, а не встаёт второй", () => {
    const got = merge([line("a", 1, "было"), line("b", 2, "два")], [line("a", 1, "стало")]);
    expect(got).toHaveLength(2);
    expect(got[0]?.body).toBe("стало");
  });

  it("исправленная старая реплика остаётся на своём месте", () => {
    // Догон упорядочен по номеру ИЗМЕНЕНИЯ, поэтому правка первой реплики
    // приезжает последней. Место в разговоре при этом прежнее.
    const before = [line("a", 1, "первая"), line("b", 2, "вторая"), line("c", 3, "третья")];
    const got = merge(before, [line("a", 1, "исправленная первая")]);
    expect(got.map((m) => m.seq)).toEqual([1, 2, 3]);
    expect(got[0]?.body).toBe("исправленная первая");
  });

  it("надгробие убирает реплику, а не оставляет пустую", () => {
    const got = merge([line("a", 1, "раз"), line("b", 2, "два")], [grave("a", 1)]);
    expect(got.map((m) => m.id)).toEqual(["b"]);
  });

  it("надгробие на незнакомую реплику ничего не ломает", () => {
    const before = [line("a", 1, "раз")];
    expect(merge(before, [grave("щ", 9)])).toHaveLength(1);
  });

  it("повторный догон ленту не меняет", () => {
    const before = [line("a", 1, "раз"), line("b", 2, "два")];
    const arrived: SyncLine[] = [line("a", 1, "раз")];
    expect(merge(merge(before, arrived), arrived)).toEqual(merge(before, arrived));
  });

  it("пустой ответ на загрузку не стирает уже показанное", () => {
    // ⚠️ ЭТО И БЫЛО МИГАНИЕ В НОВОМ КАНАЛЕ, И ИМЕННО ЗДЕСЬ Я ОШИБСЯ
    // ПЕРВЫЙ РАЗ. Чинил перенос НЕОТПРАВЛЕННОГО, а к моменту ответа
    // на загрузку сервер уже подтверждал отправку: метки состояния
    // на реплике не оставалось, и она стиралась снова.
    // Правило проще: пустой ответ не стирает ничего.
    const already = [line("настоящая", 1, "первое в канале")];
    expect(merge(already, []).map((m) => m.body)).toEqual(["первое в канале"]);
  });

  it("ответ сервера побеждает при совпадении идентификаторов", () => {
    const already = [line("a", 1, "местная копия")];
    expect(merge(already, [line("a", 1, "с сервера")])[0]?.body).toBe("с сервера");
  });

  it("записанная реплика вытесняет свой черновик, а не встаёт рядом", () => {
    // ⚠️ ЭТО И БЫЛО МЕРЦАНИЕ. Черновик лежит под своим ключом, а
    // пришедшая с сервера — под настоящим `id`. Пока они считались
    // разными репликами, строка на экране уничтожалась и создавалась
    // заново, и появление проигрывалось второй раз.
    const draft = line("ключ-1", 0.5, "первое в канале");
    const saved = { ...line("сервер-1", 12, "первое в канале"), clientMsgId: "ключ-1" };
    const got = merge([draft], [saved]);
    expect(got).toHaveLength(1);
    expect(got[0]?.id).toBe("сервер-1");
  });

  it("пустой догон возвращает ту же ленту, а не её копию", () => {
    const before = [line("a", 1, "раз")];
    expect(merge(before, [])).toBe(before);
  });
});

/**
 * ОКНО ЛЕНТЫ (task-016, Д-11).
 *
 * ⚠️ РЕЖЕМ СВЕРХУ И ТОЛЬКО СВЕРХУ. Рез снизу — это потеря только что
 * сказанного, худшая поломка ленты из возможных. Поэтому проверяется
 * не «стало 300», а КАКИЕ именно триста.
 */
describe("окно ленты", () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => line(`м${i}`, i + 1, `${i}`));

  it("без указания окна не режется ничего", () => {
    // Догрузка старого сливается тем же слиянием, и резать там нельзя:
    // человек листает вверх ровно за тем, что мы бы выбросили.
    const got = merge(many(400), [line("новая", 401, "хвост")]);
    expect(got).toHaveLength(401);
  });

  it("окно оставляет последние и выбрасывает первые", () => {
    const got = merge(many(400), [line("новая", 401, "хвост")], 300);
    expect(got).toHaveLength(300);
    expect(got.at(-1)?.body).toBe("хвост");
    // Самая старая из оставшихся — 102-я по счёту: 401 минус 300 плюс 1.
    expect(got[0]?.seq).toBe(102);
  });

  it("лента короче окна не трогается", () => {
    const before = many(10);
    expect(merge(before, [line("новая", 11, "хвост")], 300)).toHaveLength(11);
  });

  it("надгробие внутри окна не выталкивает лишнего", () => {
    // Удаление уменьшает ленту: добирать ей взамен нечего и неоткуда.
    const got = merge(many(400), [grave("м0", 1)], 300);
    expect(got).toHaveLength(300);
    expect(got.some((m) => m.id === "м0")).toBe(false);
  });
});

describe("отбор по открытой комнате", () => {
  it("чужая комната в ленту не попадает", () => {
    const before = [line("a", 1, "своё")];
    const foreign = { ...line("z", 5, "не тут"), conversationId: "друг" };
    expect(ofRoom([foreign], ROOM)).toEqual([]);
    expect(merge(before, ofRoom([foreign], ROOM))).toBe(before);
  });

  it("своя комната проходит целиком", () => {
    const own: SyncLine[] = [line("a", 1, "раз"), grave("b", 2)];
    expect(ofRoom(own, ROOM)).toHaveLength(2);
  });

  it("без открытой комнаты не проходит ничего", () => {
    expect(ofRoom([line("a", 1, "раз")], null)).toEqual([]);
  });
});

describe("слияние догона в полоску закреплённого", () => {
  it("закрепление добавляет реплику в полоску", () => {
    const got = mergePinned([], [line("a", 1, "важное", "2026-09-08T10:00:00.000Z")], ROOM);
    expect(got.map((m) => m.id)).toEqual(["a"]);
  });

  it("открепление убирает", () => {
    const before = [line("a", 1, "важное", "2026-09-08T10:00:00.000Z")];
    expect(mergePinned(before, [line("a", 1, "важное", null)], ROOM)).toEqual([]);
  });

  it("удаление закреплённого убирает и из полоски", () => {
    const before = [line("a", 1, "важное", "2026-09-08T10:00:00.000Z")];
    expect(mergePinned(before, [grave("a", 1)], ROOM)).toEqual([]);
  });

  it("свежее закрепление сверху", () => {
    const before = [line("a", 1, "раннее", "2026-09-08T10:00:00.000Z")];
    const got = mergePinned(before, [line("b", 2, "позднее", "2026-09-08T12:00:00.000Z")], ROOM);
    expect(got.map((m) => m.id)).toEqual(["b", "a"]);
  });

  it("чужая комната полоску не трогает", () => {
    const before = [line("a", 1, "важное", "2026-09-08T10:00:00.000Z")];
    const foreign = {
      ...line("z", 5, "не тут", "2026-09-08T11:00:00.000Z"),
      conversationId: "друг",
    };
    expect(mergePinned(before, [foreign], ROOM)).toBe(before);
  });

  it("без открытой комнаты полоска не трогается", () => {
    const before = [line("a", 1, "важное", "2026-09-08T10:00:00.000Z")];
    expect(mergePinned(before, [grave("a", 1)], null)).toBe(before);
  });
});

/**
 * КРАЯ ЛЕНТЫ (task-099). Лента — непрерывный отрезок: всё, что в неё
 * вливается, обязано лечь внутрь или на живой конец. Строка за краем,
 * которой в ленте нет, вставленная туда, делает дыру, которую уже никто
 * не загрузит: страница с края берёт номер этой строки своим краем.
 */
describe("края ленты", () => {
  const shown = [line("b", 20, "двадцать"), line("c", 30, "тридцать")];
  const open = { older: false, newer: false };

  it("без краёв проходит всё — лента в конце ведёт себя как раньше", () => {
    const incoming = [line("новая", 40, "сорок"), line("давняя", 5, "пять")];
    expect(inside(shown, incoming, open)).toEqual(incoming);
  });

  it("при крае «есть новее» новая строка за краем не вливается", () => {
    expect(inside(shown, [line("новая", 40, "сорок")], { older: false, newer: true })).toEqual([]);
  });

  it("при крае «есть старше» незнакомая строка ниже края не вливается", () => {
    expect(inside(shown, [line("давняя", 5, "пять")], { older: true, newer: false })).toEqual([]);
  });

  it("показанная строка проходит при любых краях: правка и надгробие доезжают", () => {
    const edges = { older: true, newer: true };
    expect(inside(shown, [line("b", 20, "поправлено"), grave("c", 30)], edges)).toHaveLength(2);
  });

  it("строка внутри отрезка проходит, даже если её не было", () => {
    // Между 20 и 30 могла быть реплика, пришедшая позже страницы.
    expect(
      inside(shown, [line("между", 25, "двадцать пять")], { older: true, newer: true }),
    ).toHaveLength(1);
  });

  it("пустая лента краёв не знает и пропускает всё", () => {
    expect(inside([], [line("a", 1, "раз")], { older: true, newer: true })).toHaveLength(1);
  });
});

describe("край ленты для догрузки", () => {
  it("черновик с дробным номером краем не считается", () => {
    const shown = [
      line("a", 10, "десятая"),
      { ...line("черновик", 10.5, "моё"), clientMsgId: "ч" },
    ];
    expect(writtenEdge(shown, "first")).toBe(10);
    expect(writtenEdge(shown, "last")).toBe(10);
  });

  it("лента из одного черновика краёв не имеет", () => {
    expect(writtenEdge([line("черновик", 60.5, "моё")], "first")).toBeUndefined();
  });
});
