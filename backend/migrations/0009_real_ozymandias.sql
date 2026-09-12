ALTER TABLE "task" ADD COLUMN "discussion_id" uuid;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "failed_runs" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Руками: ссылка на обсуждение живёт у ЗАДАЧИ, а не наоборот. Слой talk
-- ничего не знает про работу (Р-4), поэтому внешний ключ объявляется здесь,
-- а не в схеме разговоров.
--
-- ON DELETE SET NULL, а не CASCADE: удалённое обсуждение не должно уносить
-- за собой задачу. Задача старше своего обсуждения и переживает его.
ALTER TABLE "task" ADD CONSTRAINT "task_discussion_fk"
  FOREIGN KEY ("discussion_id") REFERENCES "public"."conversation"("id")
  ON DELETE SET NULL;--> statement-breakpoint

-- Счётчик отказов не бывает отрицательным. Проверка дешёвая, а ошибка
-- в сбросе счётчика иначе прошла бы молча.
ALTER TABLE "task" ADD CONSTRAINT "task_failed_runs_sane"
  CHECK ("failed_runs" >= 0);
--> statement-breakpoint
-- Обсуждение задачи — новый вид разговора. Проверка видов существовала
-- до task-011 и не знала про него: `task` в неё добавляется здесь.
--
-- Проверка, а не свободный текст: вид разговора определяет, как он
-- показывается и кому виден. Опечатка в виде — это разговор, который
-- не покажется нигде.
ALTER TABLE "conversation" DROP CONSTRAINT IF EXISTS "conversation_kind_ck";--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_kind_ck" CHECK (
  "kind" IN ('channel', 'thread', 'meeting', 'doc_thread', 'dm', 'task'));
