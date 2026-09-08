/**
 * «Тыкалка»: показать пальцем на элемент и сказать, что с ним не так.
 *
 * КАК ПОЛЬЗОВАТЬСЯ. Зажать Alt — под курсором подсвечивается элемент.
 * Щелчок — открывается поле. Написал, Enter — замечание ушло в
 * `dock/замечания.md` вместе с тем, что это за элемент. Escape — отмена.
 *
 * ЗАЧЕМ. Между «вот эта кнопка» и `Rail.tsx:69` кто-то должен положить
 * мост, иначе разговор о виде состоит из описаний словами, а описания
 * понимаются двояко.
 *
 * ⚠️ ТОЛЬКО В ДЕВ-РЕЖИМЕ. Подключается динамически и под условием
 * `import.meta.env.DEV`: сборщик выбрасывает этот файл из готовой статики
 * целиком, вместе с обработчиками.
 *
 * ⚠️ БЕЗ `prompt()` И `confirm()`. Браузерное окно останавливает всю
 * страницу и ломает работу через расширение. Поле здесь своё.
 */

/**
 * Чей это узел — цепочка компонентов React, снятая с самого узла.
 *
 * ⚠️ БЕРЁТСЯ ИЗ REACT, А НЕ ИЗ СБОРКИ, И ЭТО ВТОРАЯ ПОПЫТКА. Первая
 * вписывала адрес строки в разметку плагином Babel — и разбилась о то,
 * что `@vitejs/plugin-react` шестой версии собран на oxc: точки, куда
 * втыкают плагин Babel, там больше нет.
 *
 * React в дев-режиме вешает на каждый узел DOM свойство `__reactFiber$…`
 * со случайным хвостом. По нему поднимаемся вверх и собираем имена
 * компонентов. Получается `ChatScreen › Rail › RoomList` — вместе
 * с классами этого хватает, чтобы найти строку одним поиском.
 *
 * ⚠️ ЭТО ВНУТРЕННОСТИ REACT, И ОНИ МОГУТ ИСЧЕЗНУТЬ. Поэтому здесь нет
 * ни одной проверки «а вдруг»: если имён не нашлось, замечание всё равно
 * уходит — с тегом, классами и текстом. Оснастка, которая падает вместе
 * с чужой недокументированной подробностью, хуже отсутствующей.
 */
type Fiber = { type?: unknown; return?: Fiber };

/** Волокно React, спрятанное на самом узле DOM под именем со случайным хвостом. */
function fiberOf(node: Element): Fiber | null {
  const key = Object.keys(node).find((one) => one.startsWith("__reactFiber$"));
  if (!key) return null;
  return (node as unknown as Record<string, Fiber>)[key] ?? null;
}

/** Имя компонента. У обычного узла (`div`, `button`) его нет и брать нечего. */
function nameOf(fiber: Fiber): string | undefined {
  if (typeof fiber.type !== "function") return undefined;
  const named = fiber.type as { displayName?: string; name?: string };
  return named.displayName ?? named.name;
}

function ownersOf(node: Element): string | null {
  const names: string[] = [];
  // Предел на всякий случай: дерево бывает глубоким, а нам нужны ближайшие.
  let fiber = fiberOf(node);
  for (let step = 0; fiber && step < 40 && names.length < 4; step++) {
    const name = nameOf(fiber);
    if (name && !names.includes(name)) names.unshift(name);
    fiber = fiber.return ?? null;
  }
  return names.length > 0 ? names.join(" › ") : null;
}

/** Чем элемент опознаётся глазами: тег, немного текста, классы. */
function describe(node: Element) {
  return {
    tag: node.tagName.toLowerCase(),
    classes: node.getAttribute("class") ?? "",
    sample: (node.textContent ?? "").trim().slice(0, 60),
  };
}

function box(node: Element): HTMLDivElement {
  const frame = document.createElement("div");
  const at = node.getBoundingClientRect();
  frame.style.cssText = [
    "position:fixed",
    `left:${at.left}px`,
    `top:${at.top}px`,
    `width:${at.width}px`,
    `height:${at.height}px`,
    "border:2px solid #e7000b",
    "border-radius:4px",
    "background:rgb(231 0 11 / 8%)",
    "pointer-events:none",
    "z-index:2147483646",
  ].join(";");
  return frame;
}

/**
 * Поле замечания рядом с элементом. Возвращает написанное или ничего.
 *
 * ⚠️ ENTER ОБРАБАТЫВАЕТСЯ ЯВНО, А НЕ ЧЕРЕЗ ОТПРАВКУ ФОРМЫ. Неявная
 * отправка по Enter работает не всегда и зависит от того, сколько в форме
 * полей и есть ли кнопка. Сквозной прогон это и поймал: поле закрывалось,
 * а замечание никуда не уходило.
 *
 * ⚠️ ЗАКРЫТИЕ — ПО ЩЕЛЧКУ МИМО, А НЕ ПО ПОТЕРЕ ФОКУСА. `blur` наступает
 * раньше, чем успевает отработать Enter, и съедал написанное. Это вторая
 * половина той же поломки.
 */
function ask(node: Element): Promise<string | null> {
  return new Promise((done) => {
    const at = node.getBoundingClientRect();
    const box = document.createElement("div");
    box.style.cssText = [
      "position:fixed",
      `left:${Math.min(at.left, window.innerWidth - 340)}px`,
      `top:${Math.min(at.bottom + 8, window.innerHeight - 90)}px`,
      "z-index:2147483647",
      "padding:8px",
      "border-radius:12px",
      "background:#171717",
      "box-shadow:0 8px 24px rgb(0 0 0 / 40%)",
      "font:14px system-ui",
    ].join(";");

    const field = document.createElement("input");
    field.placeholder = "что не так? Enter — записать, Esc — отмена";
    field.style.cssText =
      "width:300px;padding:8px 10px;border:0;border-radius:8px;background:#0a0a0a;color:#fafafa;outline:none";

    box.append(field);
    document.body.append(box);
    field.focus();

    let closed = false;
    function close(answer: string | null) {
      if (closed) return;
      closed = true;
      box.remove();
      document.removeEventListener("mousedown", outside, true);
      done(answer);
    }
    function outside(event: MouseEvent) {
      if (!box.contains(event.target as Node)) close(null);
    }

    field.addEventListener("keydown", (event) => {
      // Гасим всё: страница под полем не должна ни слышать набор,
      // ни получить Escape как «закрой меню».
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        close(field.value.trim() || null);
      }
      if (event.key === "Escape") close(null);
    });

    document.addEventListener("mousedown", outside, true);
  });
}

/**
 * ⚠️ ВКЛЮЧАЕТСЯ РОВНО ОДИН РАЗ ЗА ЖИЗНЬ СТРАНИЦЫ. Горячая перезагрузка
 * выполняет модуль заново, и без этой отметки обработчики вешались вторым
 * и третьим слоем: один щелчок открывал три поля одно поверх другого,
 * а страница в какой-то момент вставала колом. Поймано сквозным прогоном.
 *
 * Отметка живёт на `window`, а не в модуле: при перезагрузке модуль
 * — новый, и его переменные тоже новые. Пережить перезагрузку может
 * только то, что лежит снаружи.
 */
const ONCE = "__amplifieAim";

export function startAim(): void {
  const already = window as unknown as Record<string, boolean>;
  if (already[ONCE]) return;
  already[ONCE] = true;

  let frame: HTMLDivElement | null = null;
  let asking = false;

  function clear() {
    frame?.remove();
    frame = null;
  }

  document.addEventListener(
    "mousemove",
    (event) => {
      if (asking) return;
      if (!event.altKey) return clear();
      const node = document.elementFromPoint(event.clientX, event.clientY);
      clear();
      if (!node) return;
      frame = box(node);
      document.body.append(frame);
    },
    true,
  );

  document.addEventListener("keyup", (event) => {
    if (event.key === "Alt" && !asking) clear();
  });

  document.addEventListener(
    "click",
    (event) => {
      if (!event.altKey || asking) return;
      const node = event.target as Element | null;
      if (!node) return;

      // Alt+щелчок принадлежит нам целиком: приложение о нём не узнаёт,
      // иначе замечание к кнопке заодно нажимало бы эту кнопку.
      event.preventDefault();
      event.stopPropagation();

      asking = true;
      void (async () => {
        const text = await ask(node);
        asking = false;
        clear();
        if (!text) return;
        const note = { text, aim: ownersOf(node), ...describe(node) };
        try {
          const answer = await fetch("/__aim", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(note),
          });
          // Говорим вслух и об успехе тоже: молчание неотличимо от потери,
          // а именно потерю мы здесь уже один раз проглядели.
          if (answer.ok) console.info(`замечание записано: ${text} → ${note.aim ?? note.tag}`);
          else console.warn(`замечание не записано: сервер ответил ${answer.status}`);
        } catch {
          console.warn("замечание не ушло: дев-сервер не ответил");
        }
      })();
    },
    true,
  );

  console.info("тыкалка включена: Alt + наведение — подсветка, Alt + щелчок — замечание");
}
