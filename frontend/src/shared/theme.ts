/**
 * Личный выбор оформления.
 *
 * Выбор хранится один раз на устройстве и всегда указывает на одну
 * настоящую палитру, чтобы все компоненты видели одни и те же роли цветов.
 */

const KEY = "amplifie.тема";

export const THEMES = [
  {
    id: "светлая",
    label: "Светлая",
    description: "Нейтральный рабочий вид на каждый день",
    group: "featured",
    tone: "light",
  },
  {
    id: "бумага",
    label: "Бумага",
    description: "Мягкий кремовый фон для долгой работы днём",
    group: "featured",
    tone: "light",
  },
  {
    id: "сепия",
    label: "Сепия",
    description: "Тёплый книжный оттенок без яркого белого",
    group: "featured",
    tone: "light",
  },
  {
    id: "сумерки",
    label: "Сумерки",
    description: "Приглушённый вид для вечера",
    group: "featured",
    tone: "dark",
  },
  {
    id: "ночь",
    label: "Ночь",
    description: "Тёмный экран с мягким светлым текстом",
    group: "featured",
    tone: "dark",
  },
  {
    id: "монохром",
    label: "Монохром",
    description: "Строгий белый фон и чёрный текст",
    group: "featured",
    tone: "light",
  },
  {
    id: "монохром тёмный",
    label: "Монохром тёмный",
    description: "Чистый тёмный контраст",
    group: "featured",
    tone: "dark",
  },
  {
    id: "гитхаб светлый",
    label: "GitHub светлый",
    description: "Светлая палитра GitHub",
    group: "featured",
    tone: "light",
  },
  {
    id: "гитхаб тёмный",
    label: "GitHub тёмный",
    description: "Тёмная палитра GitHub",
    group: "featured",
    tone: "dark",
  },
  {
    id: "фарфор",
    label: "Фарфор",
    description: "Светлый холодный оттенок",
    group: "extra",
    tone: "light",
  },
  { id: "серая", label: "Серая", description: "Нейтральный графит", group: "extra", tone: "dark" },
  {
    id: "сланец",
    label: "Сланец",
    description: "Тёплый нейтральный фон",
    group: "extra",
    tone: "light",
  },
  {
    id: "таблица",
    label: "Таблица",
    description: "Светлая деловая палитра",
    group: "extra",
    tone: "light",
  },
  {
    id: "золото",
    label: "Золото",
    description: "Светлый золотистый акцент",
    group: "extra",
    tone: "light",
  },
  {
    id: "корпоративная",
    label: "Корпоративная",
    description: "Тёмная строгая палитра",
    group: "extra",
    tone: "dark",
  },
  { id: "океан", label: "Океан", description: "Тёмный синий акцент", group: "extra", tone: "dark" },
  {
    id: "оксокарбон",
    label: "Оксокарбон",
    description: "Тёмный технический вид",
    group: "extra",
    tone: "dark",
  },
  {
    id: "самурай",
    label: "Самурай",
    description: "Тёмный вид с жёлтым акцентом",
    group: "extra",
    tone: "dark",
  },
  {
    id: "ночной город",
    label: "Ночной город",
    description: "Холодный ночной контраст",
    group: "extra",
    tone: "dark",
  },
  {
    id: "сирень",
    label: "Сирень",
    description: "Тёмный фиолетовый акцент",
    group: "extra",
    tone: "dark",
  },
  {
    id: "бирюза",
    label: "Бирюза",
    description: "Тёмный бирюзовый акцент",
    group: "extra",
    tone: "dark",
  },
  {
    id: "индиго",
    label: "Индиго",
    description: "Тёмный синий акцент",
    group: "extra",
    tone: "dark",
  },
] as const;

export type Theme = (typeof THEMES)[number]["id"];

/** Старые имена не становятся вечным публичным API: переводим разово при чтении. */
const LEGACY: Readonly<Record<string, Theme>> = {
  системная: "светлая",
  "монохром светлая": "монохром",
  алая: "ночь",
  малина: "ночь",
};

function isTheme(value: string | null): value is Theme {
  return THEMES.some((theme) => theme.id === value);
}

/** Выбранная человеком тема; старое сохранённое имя нормализуется в этом одном месте. */
export function chosen(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    if (isTheme(saved)) return saved;
    const migrated = saved === null ? undefined : LEGACY[saved];
    if (migrated !== undefined) {
      localStorage.setItem(KEY, migrated);
      return migrated;
    }
  } catch {
    // Приватный режим может запретить storage. Внешний вид не должен ронять приложение.
  }
  return "светлая";
}

/** Применить явную тему к документу. */
export function apply(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

export function remember(theme: Theme): void {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Результат виден до перезагрузки; хранение — лишь удобство, не причина падения.
  }
}
