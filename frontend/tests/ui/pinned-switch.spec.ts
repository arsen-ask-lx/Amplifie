import {
  bubble,
  createChannel,
  inviteToken,
  joinVoice,
  menu,
  openChannel,
  register,
  say,
} from "./fixtures.js";
import { expect, test } from "./guard.js";

/**
 * ЗАКРЕПЛЁННОЕ НЕ ЗАПАЗДЫВАЕТ ПРИ ПЕРЕХОДЕ (владелец 26.09: «закреплённое
 * мерцает при переключении — чат уже открыт, полоска появляется после»).
 *
 * Снимок ленты (task-114) показывается только у дочитанного чата. В чате
 * с новым лента едет с сервера — и закреплённое ехало вместе с ней, хотя
 * вкладка его уже видела. Смотрим кадры: чат на экране — полоска на месте.
 *
 * ⚠️ ОТВЕТ О ЗАКРЕПЛЁННОМ ЗАДЕРЖАН НАРОЧНО: на быстрой машине он успевал
 * до первого кадра, и сломанный код проходил бы.
 */

interface Frame {
  title: string;
  bar: boolean;
}

declare global {
  interface Window {
    pinFrames?: Frame[];
    pinRaf?: number;
  }
}

test("переход в чат с новым — полоска закреплённого с первого кадра", async ({
  page,
  playwright,
}) => {
  test.setTimeout(90_000);
  await register(page, "Закрепивший");
  await createChannel(page, "Смета");
  await say(page, "главное по смете");
  await menu(page, "главное по смете", "Закрепить");
  await expect(page.getByTitle("Перейти к закреплённому")).toBeVisible();
  const room = page.url().split("/c/")[1]?.split("/")[0] ?? "";
  await createChannel(page, "Планы");

  // Сосед пишет в «Смету»: чат с новым, снимка ленты у него не будет.
  const guest = await joinVoice(playwright.request, await inviteToken(page), "Сосед");
  const said = await guest.post(`/v1/conversations/${room}/messages`, {
    data: { body: "новое от соседа", clientMsgId: crypto.randomUUID() },
  });
  expect(said.ok()).toBe(true);
  await guest.dispose();

  await page.route("**/v1/conversations/*/pinned", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await route.continue();
  });
  await page.evaluate(() => {
    window.pinFrames = [];
    const tick = () => {
      window.pinFrames?.push({
        title: document.querySelector("h2")?.textContent ?? "",
        bar: document.querySelector('[title="Перейти к закреплённому"]') !== null,
      });
      window.pinRaf = requestAnimationFrame(tick);
    };
    tick();
  });

  await openChannel(page, "Смета");
  await expect(bubble(page, "новое от соседа")).toBeVisible();
  const frames = await page.evaluate(() => {
    if (window.pinRaf !== undefined) cancelAnimationFrame(window.pinRaf);
    return window.pinFrames ?? [];
  });

  const inRoom = frames.filter((one) => one.title === "Смета");
  expect(inRoom.length, "чат так и не открылся в кадрах").toBeGreaterThan(0);
  const bare = inRoom.filter((one) => !one.bar).length;
  expect(bare, `кадров «Сметы» без полоски: ${bare} из ${inRoom.length}`).toBe(0);
});
