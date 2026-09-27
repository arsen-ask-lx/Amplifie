import { describe, expect, it } from "vitest";
import { bayer, ordered, toGray } from "./raster.js";

/**
 * Растр входного экрана — арифметика, а не вид.
 *
 * ⚠️ ПРОВЕРЯЕМ ЧИСЛА, А НЕ КАРТИНКУ. Неверная матрица даёт полосы, и на глаз
 * это читается как «картинка битая», а не «код неверен»: искать причину
 * пойдут в фотографию, в сжатие, в экран — куда угодно, кроме этих строк.
 */

describe("матрица Байера", () => {
  /**
   * ⚠️ «БЕЗ ПОВТОРОВ» МАЛО: полосы даёт и перестановка тех же чисел. Эталон —
   * определение матрицы Байера (Wikipedia, «Ordered dithering»): M₂ = [[0,2],[3,1]],
   * M₂ₙ = [[4Mₙ, 4Mₙ+2], [4Mₙ+3, 4Mₙ+1]]. Порядок 4 посчитан вручную по нему.
   */
  it("порядок 2: ровно исходная матрица", () => {
    expect(bayer(2)).toEqual([
      [0, 2],
      [3, 1],
    ]);
  });

  it("порядок 4: ровно удвоение по определению", () => {
    expect(bayer(4)).toEqual([
      [0, 8, 2, 10],
      [12, 4, 14, 6],
      [3, 11, 1, 9],
      [15, 7, 13, 5],
    ]);
  });

  it("порядок 8 — тот, что рисует экран, — по определению от рукописной M₄", () => {
    // Ожидание строится из литерала M₄ выше, а не из `bayer(4)`: иначе неверное
    // удвоение совпало бы само с собой (ревью task-125).
    const m4 = [
      [0, 8, 2, 10],
      [12, 4, 14, 6],
      [3, 11, 1, 9],
      [15, 7, 13, 5],
    ];
    const shift = [
      [0, 2],
      [3, 1],
    ];
    const expected = Array.from({ length: 8 }, (_, y) =>
      Array.from(
        { length: 8 },
        (_, x) =>
          4 * (m4[y % 4]?.[x % 4] ?? 0) + (shift[Math.floor(y / 4)]?.[Math.floor(x / 4)] ?? 0),
      ),
    );
    expect(bayer(8)).toEqual(expected);
  });
});

/** Четыре байта на точку — тот же порядок, что отдаёт холст. */
function pixels(...values: number[]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(values.length * 4);
  for (const [at, value] of values.entries()) {
    data[at * 4] = value;
    data[at * 4 + 1] = value;
    data[at * 4 + 2] = value;
    data[at * 4 + 3] = 255;
  }
  return data;
}

describe("серое с контрастом", () => {
  it("края остаются на месте", () => {
    // Чёрное и белое контраст не двигает: двигать их некуда, и если
    // они уползают — растр теряет и плотность, и чистое небо разом.
    const gray = toGray(pixels(0, 255), 1.4);
    expect(gray[0]).toBe(0);
    expect(gray[1]).toBe(255);
  });

  it("контраст больше единицы разводит середину от центра", () => {
    const gray = toGray(pixels(160, 96), 1.4);
    // 160 светлее середины — уходит вверх; 96 темнее — вниз.
    expect(gray[0]).toBeGreaterThan(160);
    expect(gray[1]).toBeLessThan(96);
  });

  it("контраст меньше единицы стягивает к середине", () => {
    const gray = toGray(pixels(200), 0.5);
    expect(gray[0]).toBeLessThan(200);
    expect(gray[0]).toBeGreaterThan(128);
  });
});

describe("яркость", () => {
  it("отрицательная не выбивает чёрное за край", () => {
    // Яркость применяется ПОСЛЕ контраста, и при переборе она уводит
    // всю картинку в одно пятно. Края обязаны оставаться краями.
    const gray = toGray(pixels(0, 128), 1, -16);
    expect(gray[0]).toBe(0);
    expect(gray[1]).toBe(112);
  });

  it("положительная не выбивает белое за край", () => {
    const gray = toGray(pixels(255, 128), 1, 16);
    expect(gray[0]).toBe(255);
    expect(gray[1]).toBe(144);
  });
});

describe("порог", () => {
  it("на выходе только чёрное и белое", () => {
    // Одно серое пятно, просочившееся сквозь порог, отменяет весь смысл
    // растра: дальше оно поедет в холст и размоется при первом же
    // изменении размера окна.
    const width = 16;
    const height = 16;
    const gray = new Float32Array(width * height);
    for (let at = 0; at < gray.length; at++) gray[at] = (at * 37) % 256;

    ordered(gray, width, height, bayer(8));

    const seen = new Set(gray);
    expect([...seen].sort((a, b) => a - b)).toEqual([0, 255]);
  });
});
