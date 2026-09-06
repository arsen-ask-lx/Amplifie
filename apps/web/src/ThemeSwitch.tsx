import { useEffect, useState } from "react";
import { Icon, type IconName } from "./Icon.js";
import { apply, type Choice, chosen, next, remember, watchSystem } from "./theme.js";

/**
 * Переключатель темы: система → светлая → тёмная → система.
 *
 * По кругу одной кнопкой, а не списком из трёх: выбор редкий, а место
 * в панели дорогое. Текущее состояние написано словом рядом со значком —
 * значок один не отвечает на вопрос «а сейчас-то что выбрано».
 *
 * «Как в системе» — отдельное состояние, а не «светлая по умолчанию».
 * Человек, у которого система переключается по расписанию, ждёт, что
 * приложение поедет следом, и оно едет: за настройкой следим.
 */

const LOOK: Record<Choice, { icon: IconName; label: string }> = {
  система: { icon: "система", label: "Как в системе" },
  светлая: { icon: "солнце", label: "Светлая тема" },
  тёмная: { icon: "луна", label: "Тёмная тема" },
};

export function ThemeSwitch() {
  const [choice, setChoice] = useState<Choice>(chosen);

  // Пока выбрана «система», следуем за ней без перезагрузки страницы.
  useEffect(() => {
    if (choice !== "система") return;
    return watchSystem(() => apply("система"));
  }, [choice]);

  const look = LOOK[choice];

  return (
    <button
      type="button"
      className="rail-add"
      // Кнопка меняет состояние, а не открывает список: говорим, что
      // будет дальше, чтобы нажатие не было угадыванием.
      title={`${look.label} — нажмите, чтобы выбрать «${LOOK[next(choice)].label.toLowerCase()}»`}
      onClick={() => {
        const picked = next(choice);
        setChoice(picked);
        remember(picked);
        apply(picked);
      }}
    >
      <Icon name={look.icon} />
      {look.label}
    </button>
  );
}
