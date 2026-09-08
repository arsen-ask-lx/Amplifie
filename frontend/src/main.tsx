import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./app/App.js";
import { TooltipProvider } from "./shared/ui/tooltip.js";
// Geist — свой, а не с чужого домена. Пакет кладёт .woff2 рядом, сборщик
// вшивает их в статику: ни одного обращения наружу при открытии
// приложения. Подмножество с кириллицей в пакете есть — без него
// интерфейс на русском грузил бы шрифт и не мог им воспользоваться.
import "@fontsource-variable/geist";
import "./styles.css";
import { apply, chosen } from "./shared/theme.js";

// ДО отрисовки: иначе тот, кто сидит в тёмной, увидит белый первый кадр.
apply(chosen());

// «Тыкалка» — только при работе руками. Проверка статическая, поэтому
// сборщик выбрасывает и сам вызов, и весь файл за ним.
if (import.meta.env.DEV) {
  void import("./dev/aim.js").then(({ startAim }) => startAim());
}

const root = document.getElementById("root");
if (!root) throw new Error("нет узла #root");

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      {/* Один поставщик подсказок на всё приложение: он держит общую
          задержку и следит, чтобы две подсказки не висели разом. */}
      <TooltipProvider delayDuration={300}>
        <App />
      </TooltipProvider>
    </BrowserRouter>
  </StrictMode>,
);
