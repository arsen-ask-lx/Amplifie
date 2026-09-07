import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App, takeInviteFromUrl } from "./app/App.js";
import { TooltipProvider } from "./shared/ui/tooltip.js";
import "./styles.css";
import { apply, chosen } from "./shared/theme.js";

// ДО отрисовки: иначе тот, кто сидит в тёмной, увидит белый первый кадр.
apply(chosen());

/**
 * ⚠️ ТОКЕН ПРИГЛАШЕНИЯ СНИМАЕТСЯ ДО МАРШРУТИЗАТОРА, И ЭТО НЕ МЕЛОЧЬ.
 *
 * Снятие делает `history.replaceState` — правку истории мимо React Router.
 * Сделанная после его запуска, она разошлась бы с его собственным
 * представлением об истории, и «назад» повёл бы себя непредсказуемо.
 * Здесь маршрутизатора ещё нет, и спорить не с чем.
 */
const invite = takeInviteFromUrl();

const root = document.getElementById("root");
if (!root) throw new Error("нет узла #root");

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      {/* Один поставщик подсказок на всё приложение: он держит общую
          задержку и следит, чтобы две подсказки не висели разом. */}
      <TooltipProvider delayDuration={300}>
        <App invite={invite} />
      </TooltipProvider>
    </BrowserRouter>
  </StrictMode>,
);
