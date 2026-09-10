-- Чат живёт в проекте, и другого дома у него нет (task-037).
--
-- ⚠️ ЭТО ПОПРАВКА К Р-032, А НЕ НОВОЕ ЗНАНИЕ. Тогда решили: «чат может
-- жить без проекта — «Общий», курилка, личка не про проект». Пока домов
-- было два (раздел «Проекты» и раздел «Каналы»), это было верно. Владелец
-- 10.09 убрал второй: «мне не нужны отдельные каналы, оставим только
-- Проекты и там чаты». С одним домом «принадлежность необязательна»
-- означает «чат существует, но показать его негде» — то есть невидимку,
-- которую отдаёт `/v1/conversations` и не рисует ни один экран.
--
-- ⚠️ CHECK, А НЕ NOT NULL, И ЭТО НЕ ОСТОРОЖНИЧАНЬЕ. Личка и Избранное —
-- следующие на очереди, и они про людей, а не про проект. `NOT NULL`
-- пришлось бы снимать через месяц, а снятое ограничение уже не стережёт
-- ничего. Ограничение названо ровно тем, чем является: ЭТО ПРАВИЛО
-- ПРО КАНАЛЫ.
--
-- ⚠️ СНАЧАЛА ПЕРЕЕЗД, ПОТОМ ЗАМОК. Бесхозные каналы есть у всех, кто
-- регистрировался до сегодня: регистрация заводила «Общий» без проекта.
-- Не перевези мы их — миграция упала бы на CHECK, и это был бы лучший
-- из плохих исходов; но чинить чужие данные руками после падения хуже,
-- чем перевезти их здесь, в одной транзакции с самим замком.

-- Дом для осиротевших: по проекту на пространство, где такие есть.
-- Мягко удалённые каналы переезжают тоже — на них распространяется тот же
-- CHECK, и оставленные позади они уронили бы миграцию.
WITH нужен AS (
	SELECT DISTINCT workspace_id
	FROM conversation
	WHERE kind = 'channel' AND project_id IS NULL
), заведён AS (
	INSERT INTO project (workspace_id, title)
	SELECT workspace_id, 'Общее' FROM нужен
	RETURNING id, workspace_id
)
UPDATE conversation
SET project_id = заведён.id
FROM заведён
WHERE conversation.workspace_id = заведён.workspace_id
	AND conversation.kind = 'channel'
	AND conversation.project_id IS NULL;
--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_channel_lives_in_project_ck"
	CHECK (kind <> 'channel' OR project_id IS NOT NULL);
--> statement-breakpoint
-- ⚠️ КАСКАД ВМЕСТО `SET NULL`, ИНАЧЕ ДВА ПРАВИЛА БАЗЫ ПРОТИВОРЕЧАТ ДРУГ
-- ДРУГУ. `SET NULL` ставит каналу ноль, который только что запрещён
-- CHECK'ом: удаление пространства упало бы на своём же каскаде.
-- Смысл тот же, что у слова «убрать» в интерфейсе: папки нет — чатов нет.
ALTER TABLE "conversation" DROP CONSTRAINT "conversation_project_id_project_id_fk";
--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_project_id_project_id_fk"
	FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;
