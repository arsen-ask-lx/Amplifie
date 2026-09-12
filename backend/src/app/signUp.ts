import { type Actor, type RegisterInput, register } from "../kernel/identity/index.js";
import { createDefaultChannel } from "../kernel/talk/index.js";

/**
 * Слой сборки: единственное место, которому разрешено видеть все модули ядра.
 *
 * Регистрация заводит не только аккаунт: пустое пространство без канала — это
 * экран, на котором нечего делать. Но знать про чат модуль identity не должен,
 * иначе identity и talk становятся взаимно зависимыми и ни один нельзя
 * ни выбросить, ни понять по отдельности.
 *
 * Всё в одной транзакции: полурегистрация хуже отсутствующей.
 */
export async function signUp(input: RegisterInput): Promise<{ actor: Actor; token: string }> {
  return register(input, async (tx, created) => {
    await createDefaultChannel(tx, {
      workspaceId: created.workspaceId,
      participantId: created.participantId,
      title: "Общий",
    });
  });
}
