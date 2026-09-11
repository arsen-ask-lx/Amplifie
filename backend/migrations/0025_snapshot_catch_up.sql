-- Снимок схемы догнан до миграций 0017–0024 (task-039, шаг 8).
--
-- Миграции 0017–0024 писались руками, без снимков: генератор сравнивал
-- схему со снимком 0016 и заново создал бы всё, что уже есть в базе.
-- Этот файл несёт свежий снимок (meta/0025_snapshot.json), а SQL ниже —
-- только переименования: руками названные ограничения приводятся к именам,
-- которые ждёт снимок. Иначе следующая миграция по этим таблицам ссылалась
-- бы на несуществующие имена. Только метаданные: ни данных, ни типов.
--
-- CHECK и частичные индексы (pin_one_subject_ck, pin_*_uq, conversation_*_ck)
-- по-прежнему живут только в SQL: так принято в проекте (drizzle.config.ts),
-- генератор не трогает того, чего нет ни в схеме, ни в снимке.
ALTER TABLE "conversation_read" RENAME CONSTRAINT "conversation_read_conversation_id_fk" TO "conversation_read_conversation_id_conversation_id_fk";--> statement-breakpoint
ALTER TABLE "conversation_read" RENAME CONSTRAINT "conversation_read_participant_id_fk" TO "conversation_read_participant_id_participant_id_fk";--> statement-breakpoint
ALTER TABLE "conversation_read" RENAME CONSTRAINT "conversation_read_pk" TO "conversation_read_conversation_id_participant_id_pk";--> statement-breakpoint
ALTER TABLE "message_mention" RENAME CONSTRAINT "message_mention_pk" TO "message_mention_message_id_participant_id_pk";
