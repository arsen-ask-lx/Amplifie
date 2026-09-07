import { type Actor, type JoinInput, joinByInvite } from "../kernel/identity/index.js";
import { addToRootChannel } from "../kernel/talk/index.js";

/**
 * Вход по приглашению — со стороны сборки.
 *
 * identity заводит аккаунт и участника, talk сажает его в канал. Знать друг
 * о друге им незачем: шов проходит здесь, как и у регистрации.
 *
 * Всё в одной транзакции. Участник без канала — это вход на пустой экран,
 * то есть половина работы, выданная за целую.
 */
export async function acceptInvite(input: JoinInput): Promise<{ actor: Actor; token: string }> {
  return joinByInvite(input, async (tx, created) => {
    await addToRootChannel(tx, {
      workspaceId: created.workspaceId,
      participantId: created.participantId,
    });
  });
}
