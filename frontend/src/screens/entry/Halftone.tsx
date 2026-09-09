import { useCallback, useEffect, useRef, useState } from "react";
import source from "../../assets/bridge.webp";
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
 * Контраст фотографии до растра. Выбран владельцем по живому прогону: 1.40.
 *
 * Точка растра при этом равна одному пикселю экрана — тот же выбор, только
 * его нечем записать числом: крупная точка потребовала бы считать растр
 * в уменьшенном виде и увеличивать целым числом, а это уже другой вид,
 * а не подстройка.
 */
const CONTRAST = 1.4;

/** Порядок матрицы: сетка 8. */
const MATRIX = bayer(8);

interface Props {
  className?: string;
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

export function Halftone({ className }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const image = useRef<HTMLImageElement | null>(null);
  const frame = useRef(0);
  const [ready, setReady] = useState(false);

  const draw = useCallback(() => {
    const picture = image.current;
    const surface = canvas.current;
    const holder = box.current;
    if (!picture || !surface || !holder) return;

    const context = surface.getContext("2d", { willReadFrequently: true });
    if (!context) return;

    const rect = holder.getBoundingClientRect();
    // Пиксели устройства, а не CSS: только так точка совпадает с пикселем.
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width * ratio));
    const height = Math.max(1, Math.round(rect.height * ratio));
    if (surface.width !== width) surface.width = width;
    if (surface.height !== height) surface.height = height;

    context.drawImage(picture, ...cover(picture, width, height));

    const frameData = context.getImageData(0, 0, width, height);
    const gray = toGray(frameData.data, CONTRAST);
    ordered(gray, width, height, MATRIX);
    paint(frameData.data, gray);
    context.putImageData(frameData, 0, 0);
  }, []);

  /** Не чаще кадра: рамку окна тянут непрерывно, а растр считается заново. */
  const schedule = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(draw);
  }, [draw]);

  useEffect(() => {
    const picture = new Image();
    picture.src = source;
    picture.decode().then(
      () => {
        image.current = picture;
        setReady(true);
      },
      () => {
        // Картинка не доехала. Обработано молча и намеренно: на её месте
        // остаётся фон, форма входа работает, а человеку сказать нечего —
        // чинить тут нечего и некому.
        setReady(false);
      },
    );
  }, []);

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
    <div ref={box} className={className} aria-hidden="true">
      <canvas ref={canvas} className="block h-full w-full" />
    </div>
  );
}
