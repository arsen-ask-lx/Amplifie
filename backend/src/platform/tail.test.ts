import { beforeEach, describe, expect, it } from "vitest";
import { forget, remember, tailSize, visibleTo } from "./tail.js";

/**
 * ТОЧЕЧНЫЕ ПРОВЕРКИ КОЛЬЦА ИЗМЕНЕНИЙ (task-067).
 *
 * ⚠️ ЗДЕСЬ ТОЧЕЧНЫЕ, А НЕ ПРИЁМОЧНЫЕ, И ЭТО ОБОСНОВАНО. Снаружи кольцо
 * не обнулить и не переполнить: чтобы выбить курсор за хвост, пришлось бы
 * отправить пятьсот тринадцать реплик через порог частоты. А главное
 * свойство кольца — «не помню — значит скажи прямо» — это чистая логика
 * без базы и без сети. Наблюдаемое поведение догона проверяют приёмочные.
 */

const SPACE = "00000000-0000-0000-0000-0000000000ws";
const ME = "участник-я";
const OTHER = "участник-другой";

/** Изменение, которое хвост умеет описать: новая реплика видна всем. */
function seen(seq: number, audience: string[] | null = null) {
  return { seq, audience, line: { id: `реплика-${seq}`, seq } };
}

describe("кольцо изменений", () => {
  beforeEach(() => forget(SPACE));

  it("пустое кольцо честно отправляет в базу", () => {
    expect(visibleTo(SPACE, 0, 50, ME)).toBeNull();
  });

  it("отдаёт то, что случилось после курсора, и говорит свою границу", () => {
    remember(SPACE, seen(10));
    remember(SPACE, seen(11));
    remember(SPACE, seen(12));

    const page = visibleTo<{ seq: number }>(SPACE, 10, 50, ME);
    expect(page?.head, "граница ответа").toBe(12);
    expect(
      page?.lines.map((one) => one.seq),
      "только после курсора",
    ).toEqual([11, 12]);
  });

  it("курсор старше хвоста отправляет в базу, а не отдаёт огрызок", () => {
    // Самая опасная ошибка: ответить тем, что помним, и промолчать
    // про пропущенное. Человек не увидит дыру — он увидит непрерывную
    // ленту без одной реплики.
    remember(SPACE, seen(10));
    remember(SPACE, seen(11));

    expect(visibleTo(SPACE, 5, 50, ME), "курсор раньше начала хвоста").toBeNull();
  });

  it("курсор из будущего отправляет в базу", () => {
    remember(SPACE, seen(10));
    expect(visibleTo(SPACE, 99, 50, ME), "курсор дальше, чем мы знаем").toBeNull();
  });

  it("дыра в номерах сбрасывает хвост целиком", () => {
    // Между 10 и 12 что-то случилось и не было описано — например правка.
    // Отвечать из памяти нельзя даже про 12.
    remember(SPACE, seen(10));
    remember(SPACE, seen(12));

    expect(visibleTo(SPACE, 10, 50, ME), "после дыры память не отвечает").toBeNull();
    expect(tailSize().workspaces, "пространство забыто").toBe(0);
  });

  it("номер, пошедший назад, сбрасывает хвост", () => {
    remember(SPACE, seen(10));
    remember(SPACE, seen(11));
    remember(SPACE, seen(11));

    expect(visibleTo(SPACE, 10, 50, ME)).toBeNull();
  });

  it("закрытый разговор не виден постороннему на быстрой дороге", () => {
    remember(SPACE, seen(10));
    remember(SPACE, { ...seen(11), audience: [OTHER] });
    remember(SPACE, seen(12));

    const mine = visibleTo<{ seq: number }>(SPACE, 9, 50, ME);
    expect(
      mine?.lines.map((one) => one.seq),
      "чужая закрытая реплика",
    ).toEqual([10, 12]);
    // Граница всё равно двигается: иначе человек вечно переспрашивал бы
    // про изменение, которого ему не видно.
    expect(mine?.head, "граница не зависит от видимости").toBe(12);

    const theirs = visibleTo<{ seq: number }>(SPACE, 9, 50, OTHER);
    expect(
      theirs?.lines.map((one) => one.seq),
      "участнику видно всё",
    ).toEqual([10, 11, 12]);
  });

  it("страница больше запрошенной отправляет в базу", () => {
    // Со страницами разбирается одна дорога, и это база: два места,
    // считающих `hasMore`, разошлись бы.
    remember(SPACE, seen(10));
    remember(SPACE, seen(11));
    remember(SPACE, seen(12));

    expect(visibleTo(SPACE, 9, 2, ME), "три записи при пределе два").toBeNull();
  });

  it("кольцо не растёт без предела и честно двигает своё начало", () => {
    for (let seq = 1; seq <= 600; seq++) remember(SPACE, seen(seq));

    expect(tailSize().entries, "кольцо ограничено").toBeLessThanOrEqual(512);
    expect(visibleTo(SPACE, 1, 1000, ME), "выпавший курсор — в базу").toBeNull();
    expect(visibleTo(SPACE, 599, 50, ME)?.lines, "свежий курсор отвечается из памяти").toHaveLength(
      1,
    );
  });

  it("забытое пространство не занимает память", () => {
    remember(SPACE, seen(10));
    forget(SPACE);
    expect(tailSize()).toEqual({ workspaces: 0, entries: 0 });
  });
});
