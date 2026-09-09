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
  it("порядок 2: четыре порога без повторов", () => {
    const m = bayer(2);
    expect(m.length).toBe(2);
    expect(m.every((row) => row.length === 2)).toBe(true);
    expect([...m.flat()].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  });

  it("порядок 4: шестнадцать порогов без повторов", () => {
    const m = bayer(4);
    expect(m.length).toBe(4);
    const all = [...m.flat()].sort((a, b) => a - b);
    expect(all).toEqual(Array.from({ length: 16 }, (_, i) => i));
  });

  it("порядок 8: шестьдесят четыре порога без повторов", () => {
    const m = bayer(8);
    expect(m.length).toBe(8);
    expect(m.every((row) => row.length === 8)).toBe(true);
    const all = [...m.flat()].sort((a, b) => a - b);
    expect(all).toEqual(Array.from({ length: 64 }, (_, i) => i));
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
