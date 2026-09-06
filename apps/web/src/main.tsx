import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./styles.css";
import { apply, chosen } from "./theme.js";

// ДО отрисовки: иначе тот, кто сидит в тёмной, увидит белый первый кадр.
apply(chosen());

const root = document.getElementById("root");
if (!root) throw new Error("нет узла #root");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
