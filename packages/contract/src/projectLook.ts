/**
 * Вид проекта: значок и цвет (task-038).
 *
 * ⚠️ ОБЩЕЕ ЗНАНИЕ, ПОТОМУ ЧТО ОБЕ СТОРОНЫ ОБЯЗАНЫ ПОНИМАТЬ ЕГО ОДИНАКОВО.
 * Фронт рисует по этим именам список для выбора, бек по ним же проверяет
 * пришедшее. Разъедься списки — человек выбрал бы значок, которого
 * сервер не знает, и получил бы отказ на ровном месте.
 *
 * ⚠️ ИМЕНА, А НЕ ЗНАЧЕНИЯ. В базе лежит `briefcase`, а не путь к картинке
 * и не `#b86d1e`. Цвет — токен интерфейса (`--tag-orange`); сегодня
 * у него одно значение на все темы, подобранное под порог контраста
 * на каждой, но поменять его можно в одном месте, не трогая базу.
 * Значок — компонент из набора. Запиши мы сюда значения — любая правка
 * цвета или набора иконок стала бы миграцией данных.
 */

/**
 * Цвета меток. Семь, как у Codex, и без серого: папка без выбранного
 * цвета берёт приглушённый цвет темы. Значения живут в `styles.css`
 * (одно на все темы) и проверены гейтом контраста на всех девятнадцати.
 */
export const PROJECT_COLORS = [
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "violet",
  "pink",
] as const;

export type ProjectColor = (typeof PROJECT_COLORS)[number];

/**
 * Значки — девять десятков, и набор НАШ, а не срисованный с Codex
 * (владелец, 10.09: «сделать иконки не как в gpt, а наши разные, пусть
 * их будет намного больше»).
 *
 * ⚠️ ПОРЯДОК В СПИСКЕ — ЭТО ПОРЯДОК НА ЭКРАНЕ, и он по смыслу, а не по
 * алфавиту: сперва стройка, потом техника, перевозки, деньги, бумаги,
 * люди и метки. Человек ищет глазами в той области, где ожидает найти;
 * алфавит по английским именам ему в этом не помощник вовсе.
 *
 * ⚠️ ИМЕНА ИЗ СПИСКА НЕ УДАЛЯЮТСЯ. Дописать строку можно всегда, убрать —
 * уже нет: значок к тому времени стоит у чьей-то папки, и она осиротеет.
 */
export const PROJECT_ICONS = [
  // Стройка — то, чем занят владелец и его коллеги каждый день.
  "folder",
  "house",
  "buildings",
  "crane",
  "helmet",
  "hammer",
  "wrench",
  "screwdriver",
  "toolbox",
  "ladder",
  "roller",
  "ruler",
  "blueprint",
  "wall",
  "pipe",
  "cube",
  // Инженерия и техника.
  "plug",
  "power",
  "battery",
  "gear",
  "nut",
  "cpu",
  "cloud",
  "wifi",
  // Перевозки.
  "truck",
  "van",
  "car",
  "train",
  "boat",
  "plane",
  "package",
  // Деньги и дела.
  "money",
  "bank",
  "receipt",
  "calculator",
  "chart",
  "graph",
  "presentation",
  "briefcase",
  "handshake",
  "scales",
  // Бумаги и связь.
  "doc",
  "news",
  "mail",
  "phone",
  "megaphone",
  "calendar",
  "clock",
  "printer",
  // Люди и доступ.
  "users",
  "person",
  "key",
  "lock",
  "shield",
  // Метки и прочее.
  "star",
  "flag",
  "target",
  "fire",
  "leaf",
  "tree",
  "mountains",
  "sun",
  "coffee",
  "cart",
  "tag",
  "bell",
  "rocket",
  "camera",
  "globe",
  "idea",
  "heart",
  "trophy",
  "medal",
  "compass",
  "place",
  "anchor",
  "sparkle",
  "book",
  "cap",
  "pencil",
  "code",
  "music",
  "gift",
  "scissors",
  "palette",
  "health",
  "flower",
  "sport",
  "pet",
  "science",
] as const;

export type ProjectIcon = (typeof PROJECT_ICONS)[number];
