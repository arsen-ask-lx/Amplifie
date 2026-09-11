import { ArrowLeft, Check, Palette, Robot, TextAa, UserCircle } from "@phosphor-icons/react";
import { useState } from "react";
import { Link, useLocation } from "react-router";
import type { Me } from "../data/api.js";
import { AgentsScreen } from "../screens/agents/AgentsScreen.js";
import {
  applyTextScale,
  chosenTextScale,
  rememberTextScale,
  TEXT_SCALES,
  type TextScale,
} from "../shared/text-scale.js";
import { apply, chosen, remember, THEMES, type Theme } from "../shared/theme.js";

type Section = "profile" | "appearance" | "agents";

const SECTIONS: Array<{ id: Section; label: string; icon: typeof UserCircle }> = [
  { id: "profile", label: "Профиль", icon: UserCircle },
  { id: "appearance", label: "Внешний вид", icon: Palette },
  { id: "agents", label: "Агенты", icon: Robot },
];

function currentSection(pathname: string): Section {
  if (pathname === "/settings/profile") return "profile";
  if (pathname === "/settings/agents") return "agents";
  return "appearance";
}

function ProfilePage({ me }: { me: Me }) {
  return (
    <section className="w-full">
      <h1 className="text-head font-semibold text-ink">Профиль</h1>
      <p className="mt-2 text-body text-muted">Ваши данные в Amplifie.</p>

      <dl className="mt-8 overflow-hidden rounded-lg border border-line bg-panel">
        <div className="grid gap-1 border-b border-line px-5 py-4 sm:grid-cols-[12rem_1fr] sm:items-center">
          <dt className="text-aside text-muted">Имя</dt>
          <dd className="text-body text-ink">{me.participant.displayName}</dd>
        </div>
        <div className="grid gap-1 border-b border-line px-5 py-4 sm:grid-cols-[12rem_1fr] sm:items-center">
          <dt className="text-aside text-muted">Почта</dt>
          <dd className="text-body text-ink">{me.account.email}</dd>
        </div>
        <div className="grid gap-1 px-5 py-4 sm:grid-cols-[12rem_1fr] sm:items-center">
          <dt className="text-aside text-muted">Пространство</dt>
          <dd className="text-body text-ink">{me.workspace.name}</dd>
        </div>
      </dl>
    </section>
  );
}

function AppearancePage() {
  const [theme, setTheme] = useState<Theme>(chosen);
  const [textScale, setTextScale] = useState<TextScale>(chosenTextScale);
  // Выбранная редкая тема не должна исчезать после перезагрузки за кнопкой
  // «Ещё»: иначе человек не видит, какой вид сейчас активен.
  const [extrasOpen, setExtrasOpen] = useState(
    () => THEMES.find((candidate) => candidate.id === theme)?.group === "extra",
  );
  const displayedThemes = extrasOpen
    ? THEMES
    : THEMES.filter((candidate) => candidate.group === "featured");

  function pickTheme(next: Theme) {
    setTheme(next);
    remember(next);
    apply(next);
  }

  function pickTextScale(next: TextScale) {
    setTextScale(next);
    rememberTextScale(next);
    applyTextScale(next);
  }

  return (
    <section className="w-full">
      <h1 className="text-head font-semibold text-ink">Внешний вид</h1>
      <p className="mt-2 text-body text-muted">Настройки этого устройства.</p>

      <section className="mt-8" aria-labelledby="theme-heading">
        <h2 id="theme-heading" className="text-lead font-semibold text-ink">
          Тема
        </h2>
        <p className="mt-1 text-aside text-muted">
          Один готовый вид вместо ручной настройки цветов.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {displayedThemes.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              aria-label={candidate.label}
              aria-description={candidate.description}
              aria-pressed={theme === candidate.id}
              onClick={() => pickTheme(candidate.id)}
              className="group rounded-lg border-2 border-transparent bg-transparent p-1 text-left outline-none transition-colors hover:bg-raised focus-visible:border-accent aria-pressed:border-accent"
            >
              <span
                data-theme={candidate.id}
                className="block h-16 overflow-hidden rounded-md bg-bg p-2.5"
              >
                <span className="flex items-center gap-1">
                  <span className="size-2 rounded-pill bg-accent" />
                  <span className="block h-1.5 w-2/5 rounded-pill bg-muted/50" />
                </span>
                <span className="mt-2 block rounded bg-panel p-1.5">
                  <span className="block h-1 w-3/5 rounded-pill bg-muted/50" />
                  <span className="mt-1.5 block h-1 w-full rounded-pill bg-muted/30" />
                </span>
              </span>
              <span className="flex items-center gap-1.5 px-1.5 pb-0.5 pt-1.5 text-aside text-ink">
                <span className="truncate">{candidate.label}</span>
                {theme === candidate.id ? (
                  <Check className="ml-auto size-4 shrink-0 text-accent" />
                ) : null}
              </span>
              <span className="block truncate px-1.5 pb-1 text-mark text-muted">
                {candidate.description}
              </span>
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-expanded={extrasOpen}
          onClick={() => setExtrasOpen((open) => !open)}
          className="mt-3 rounded border border-edge px-3 py-1.5 text-aside text-ink transition-colors hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent"
        >
          {extrasOpen ? "Скрыть дополнительные темы" : "Ещё темы"}
        </button>
      </section>

      <section className="mt-10" aria-labelledby="scale-heading">
        <div className="flex items-center gap-2">
          <TextAa className="size-5 text-muted" />
          <h2 id="scale-heading" className="text-lead font-semibold text-ink">
            Размер текста
          </h2>
        </div>
        <p className="mt-1 text-aside text-muted">
          Меняет текст в панели и переписке, не меняя размер кнопок.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {TEXT_SCALES.map((scale) => (
            <button
              key={scale}
              type="button"
              aria-pressed={textScale === scale}
              onClick={() => pickTextScale(scale)}
              className="rounded-lg border-2 border-line bg-panel px-4 py-3 text-left outline-none transition-colors hover:bg-raised focus-visible:border-accent aria-pressed:border-accent"
            >
              <span className="block text-lead font-semibold text-ink">{scale}%</span>
              <span className="mt-1 block text-mark text-muted">Размер интерфейса</span>
            </button>
          ))}
        </div>
      </section>
    </section>
  );
}

export function SettingsScreen({ me }: { me: Me }) {
  const location = useLocation();
  const section = currentSection(location.pathname);

  return (
    <div className="flex h-dvh overflow-hidden bg-bg text-ink">
      <aside className="flex w-72 shrink-0 flex-col border-r border-line bg-panel p-3">
        <Link
          to="/"
          className="flex items-center gap-2 rounded px-2.5 py-2 text-body text-ink no-underline transition-colors hover:bg-raised"
        >
          <ArrowLeft className="size-4" />
          Вернуться в приложение
        </Link>

        <nav className="mt-8 flex flex-col gap-0.5" aria-label="Настройки">
          <p className="px-2.5 pb-2 text-aside font-medium text-muted">Личные настройки</p>
          {SECTIONS.map((item) => {
            const Icon = item.icon;
            const active = section === item.id;
            return (
              <Link
                key={item.id}
                to={`/settings/${item.id}`}
                aria-current={active ? "page" : undefined}
                className={[
                  "flex items-center gap-2.5 rounded px-2.5 py-2 text-body no-underline transition-colors",
                  active
                    ? "bg-selected font-medium text-ink"
                    : "text-muted hover:bg-raised hover:text-ink",
                ].join(" ")}
              >
                <Icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto px-6 py-12 sm:px-10">
        <div className="mx-auto w-full max-w-4xl">
          {section === "profile" ? <ProfilePage me={me} /> : null}
          {section === "appearance" ? <AppearancePage /> : null}
          {section === "agents" ? <AgentsScreen embedded /> : null}
        </div>
      </main>
    </div>
  );
}
