import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../../shared/utils.js";
import type { Picture } from "./pictures.js";
import { bayer, ordered, toGray } from "./raster.js";

/**
 * Картинка входа: серая фотография, растр — по пикселям устройства (task-022).
 *
 * ⚠️ ХОЛСТ, А НЕ `<img>`. Готовый растровый файл резок ровно при показе один
 * к одному. Высота окна у всех разная, множитель экрана бывает 1, 1.25, 2 —
 * на любом другом размере точка попадает между пикселями, и вместо растра
 * выходит рябь. Здесь растр считается заново под текущий размер, поэтому
 * каждая точка ложится в пиксель на любом экране и при любой рамке окна.
 *
 * ⚠️ ФОРМА ВХОДА ОТ ЭТОГО НЕ ЗАВИСИТ. Не загрузилось, нет холста, отключён
 * — на месте картинки остаётся фон, и дверь работает. Украшение не имеет
 * права ломать вход.
 */

/**
 * Порядок матрицы: сетка 8. Общий для всех картинок — это язык, а не
 * подстройка: разные сетки на соседних экранах читались бы как разные
 * продукты. Всё, что подбирается под картинку, живёт в `pictures.ts`.
 */
const MATRIX = bayer(8);

interface Props {
  /** Что рисовать и с какими числами. */
  picture: Picture;
  className?: string;
  /** Прозрачность на время растворения — задаёт рама. */
  style?: CSSProperties;
}

/**
 * Две краски обратно в буфер холста.
 *
 * Вынесено из отрисовки не ради красоты: со вложенным циклом та набирала
 * сложность 12 при потолке 10, и линтер был прав — там уже читалось
 * «кадрирование, растр и запись» одним куском.
 *
 * Утверждение по индексу — по той же причине, что в `raster.ts`: буфер
 * плотный, а счётчик идёт по его же длине.
 */
function paint(data: Uint8ClampedArray, gray: Float32Array): void {
  for (let at = 0, dot = 0; at < data.length; at += 4, dot++) {
    const value = gray[dot] as number;
    data[at] = value;
    data[at + 1] = value;
    data[at + 2] = value;
    data[at + 3] = 255;
  }
}

/**
 * Подогнать холст под место и вернуть его размер в пикселях устройства.
 *
 * Вынесено из отрисовки: та набрала сложность 12 при потолке 10, и линтер
 * был прав — «какого размера холст» и «что на нём рисуют» разные вопросы.
 */
function fitCanvas(
  surface: HTMLCanvasElement,
  holder: HTMLDivElement,
): { width: number; height: number } {
  const rect = holder.getBoundingClientRect();
  // Пиксели устройства, а не CSS: только так точка совпадает с пикселем.
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width * ratio));
  const height = Math.max(1, Math.round(rect.height * ratio));
  if (surface.width !== width) surface.width = width;
  if (surface.height !== height) surface.height = height;
  return { width, height };
}

/** Кадрирование «по большей стороне»: заполнить, не искажая. */
function cover(
  image: HTMLImageElement,
  width: number,
  height: number,
): [number, number, number, number] {
  const scale = Math.max(width / image.width, height / image.height);
  const drawn = { w: image.width * scale, h: image.height * scale };
  return [(width - drawn.w) / 2, (height - drawn.h) / 2, drawn.w, drawn.h];
}

export function Halftone({ picture, className, style }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const image = useRef<HTMLImageElement | null>(null);
  const frame = useRef(0);
  const [ready, setReady] = useState(false);

  const draw = useCallback(() => {
    const loaded = image.current;
    const surface = canvas.current;
    const holder = box.current;
    if (!loaded || !surface || !holder) return;

    const context = surface.getContext("2d", { willReadFrequently: true });
    if (!context) return;

    // ⚠️ РАЗМЫТИЕ СЧИТАЕТ БРАУЗЕР, А НЕ ПОДГОТОВКА ФАЙЛА. Усреднить
    // штриховку можно было бы заранее, но размытие ДО уменьшения и ПОСЛЕ
    // дают разный результат: подобранное ползунком не совпало бы с тем,
    // что рисует продукт. Здесь оно на том же шаге, что и в настройке.
    context.filter = picture.blur > 0 ? `blur(${picture.blur}px)` : "none";

    const { width, height } = fitCanvas(surface, holder);

    context.drawImage(loaded, ...cover(loaded, width, height));
    context.filter = "none";

    const frameData = context.getImageData(0, 0, width, height);
    const gray = toGray(frameData.data, picture.contrast, picture.bright);
    ordered(gray, width, height, MATRIX);
    paint(frameData.data, gray);
    context.putImageData(frameData, 0, 0);
  }, [picture]);

  /** Не чаще кадра: рамку окна тянут непрерывно, а растр считается заново. */
  const schedule = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(draw);
  }, [draw]);

  useEffect(() => {
    // Каждая картинка едет только тогда, когда её показывают: вторая
    // не грузится, пока человек не дошёл до её шага.
    setReady(false);
    const loading = new Image();
    loading.src = picture.src;
    loading.decode().then(
      () => {
        image.current = loading;
        setReady(true);
      },
      () => {
        // Картинка не доехала. Обработано молча и намеренно: на её месте
        // остаётся фон, форма входа работает, а человеку сказать нечего —
        // чинить тут нечего и некому.
        setReady(false);
      },
    );
  }, [picture.src]);

  useEffect(() => {
    if (!ready) return;
    // ⚠️ ПЕРВЫЙ РАЗ — СРАЗУ, А НЕ КАДРОМ. В фоновой вкладке
    // `requestAnimationFrame` не идёт вовсе, и картинка оставалась пустой
    // до тех пор, пока на вкладку не посмотрят. Откладывать первую
    // отрисовку незачем: она одна, дросселировать нечего.
    // Найдено сквозным прогоном: холст был нужного размера и весь белый.
    draw();

    const holder = box.current;
    if (!holder) return;

    const watcher = new ResizeObserver(schedule);
    watcher.observe(holder);
    // Отдельно от наблюдателя: при переносе окна на другой монитор размер
    // в CSS тот же, а множитель экрана другой — наблюдатель промолчит.
    window.addEventListener("resize", schedule);

    return () => {
      watcher.disconnect();
      window.removeEventListener("resize", schedule);
      cancelAnimationFrame(frame.current);
    };
  }, [ready, draw, schedule]);

  return (
    /**
     * ⚠️ КОРОБКА ОТНОСИТЕЛЬНАЯ, ХОЛСТ ВНУТРИ НЕЁ АБСОЛЮТНЫЙ. Без этого
     * холст участвует в раскладке СВОИМ размером и раздувает всё вокруг.
     *
     * Как это выглядело: у холста стоял `h-full`, а у коробки высота была
     * автоматической. Проценты от «авто» не считаются, и браузер брал
     * собственный размер холста — тот, что записан в его атрибутах
     * (953×1526 пикселей устройства). По пропорции выходило 1221 точки
     * в высоту при окне в 639: рама растягивалась вдвое, форма уезжала
     * вниз, а картинка кадрировалась как увеличенная.
     *
     * И это само себя поддерживало: изменение окна → пересчёт → новые
     * атрибуты → новая «своя» высота → рама снова поехала. Отсюда
     * «всё плывёт при открытии и закрытии панели разработчика».
     *
     * Абсолютный холст из потока выведен и раздуть уже ничего не может,
     * кем бы ни была коробка снаружи.
     */
    <div
      ref={box}
      /* ⚠️ ЧЕРЕЗ `cn`, А НЕ СКЛЕЙКОЙ СТРОК. Хозяин передаёт своё положение
        (`absolute inset-0` при растворении), и склейка давала два класса
        положения разом — «relative absolute». Спор решал порядок в собранном
        стиле, побеждал не тот, коробка теряла высоту, и картинка исчезала
        вовсе. `cn` выбрасывает проигравшего заранее — ради этого он и есть. */
      className={cn("relative", className)}
      style={style}
      aria-hidden="true"
    >
      <canvas ref={canvas} className="absolute inset-0 block size-full" />
    </div>
  );
}
