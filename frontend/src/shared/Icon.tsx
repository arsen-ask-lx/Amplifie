/**
 * Значки.
 *
 * Разметкой, а не библиотекой: нужных штук десять, и они не стоят
 * зависимости (Р-014). Контуры взяты из Lucide, лицензия ISC —
 * уведомление ниже сохраняется вместе с ними.
 *
 * ISC License · Copyright (c) Lucide Contributors · https://lucide.dev/license
 *
 * Значок здесь — не украшение, а второй признак вдобавок к слову.
 * Поэтому у него `aria-hidden`: имя раздела рядом, и читать его вслух
 * дважды незачем.
 */

export type IconName =
  | "hash"
  | "branch"
  | "tasks"
  | "model"
  | "search"
  | "plus"
  | "logout"
  | "invite"
  | "dot"
  | "sun"
  | "moon"
  | "system";

/** Контуры Lucide: hash, git-branch, check-square, cpu, search, plus, log-out, user-plus, circle. */
const PATHS: Record<IconName, string[]> = {
  hash: ["M4 9h16", "M4 15h16", "M10 3 8 21", "M16 3l-2 18"],
  branch: [
    "M6 3v12",
    "M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
    "M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
    "M15 6a9 9 0 0 1-9 9",
  ],
  tasks: ["M9 11l3 3L22 4", "M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"],
  model: ["M12 8V4H8", "M4 8h16v12H4z", "M2 14h2", "M20 14h2", "M15 13v2", "M9 13v2"],
  search: ["M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z", "M21 21l-4.3-4.3"],
  plus: ["M5 12h14", "M12 5v14"],
  logout: ["M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4", "M16 17l5-5-5-5", "M21 12H9"],
  invite: [
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",
    "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
    "M19 8v6",
    "M22 11h-6",
  ],
  dot: ["M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z"],
  sun: [
    "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z",
    "M12 1v2",
    "M12 21v2",
    "M4.2 4.2l1.4 1.4",
    "M18.4 18.4l1.4 1.4",
    "M1 12h2",
    "M21 12h2",
    "M4.2 19.8l1.4-1.4",
    "M18.4 5.6l1.4-1.4",
  ],
  moon: ["M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"],
  system: ["M4 4h16v12H4z", "M8 20h8", "M12 16v4"],
};

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
