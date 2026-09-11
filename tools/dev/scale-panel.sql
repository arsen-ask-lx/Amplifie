-- Нагрузочный набор боковой панели. Запуск: make scale-seed.
--
-- Это намеренно только разговоры и проекты: для проверки выдачи и DOM не
-- нужны фальшивые сообщения. Каждая запись помечена «Нагрузка ·», поэтому
-- повторный запуск добавляет только недостающие строки и не трогает рабочие.
\set ON_ERROR_STOP on

BEGIN;

SELECT set_config('amplifie.seed_workspace_id', :'workspace_id', false);

DO $$
BEGIN
  IF (SELECT count(*) FROM workspace WHERE id::text = current_setting('amplifie.seed_workspace_id')) <> 1 THEN
    RAISE EXCEPTION 'указанное пространство не найдено';
  END IF;
END $$;

WITH chosen AS (
  SELECT id FROM workspace WHERE id::text = current_setting('amplifie.seed_workspace_id')
), desired AS (
  SELECT n, format('Нагрузка · Проект %s', n) AS title
  FROM generate_series(1, 100) AS n
)
INSERT INTO project (workspace_id, title)
SELECT chosen.id, desired.title
FROM chosen CROSS JOIN desired
WHERE NOT EXISTS (
  SELECT 1 FROM project existing
  WHERE existing.workspace_id = chosen.id
    AND existing.deleted_at IS NULL
    AND existing.title = desired.title
);

WITH chosen AS (
  SELECT id FROM workspace WHERE id::text = current_setting('amplifie.seed_workspace_id')
), desired AS (
  SELECT project_number, chat_number,
         format('Нагрузка · Чат %s-%s', project_number, chat_number) AS title
  FROM generate_series(1, 100) AS project_number
  CROSS JOIN LATERAL generate_series(1, 10 + (project_number % 91)) AS chat_number
), targets AS (
  SELECT chosen.id AS workspace_id, project.id AS project_id, desired.title,
         desired.project_number, desired.chat_number
  FROM chosen
  CROSS JOIN desired
  JOIN project ON project.workspace_id = chosen.id
    AND project.deleted_at IS NULL
    AND project.title = format('Нагрузка · Проект %s', desired.project_number)
)
INSERT INTO conversation (workspace_id, kind, title, project_id, created_at)
SELECT workspace_id, 'channel', title, project_id,
       now() - make_interval(secs => (project_number * 101 + chat_number))
FROM targets
WHERE NOT EXISTS (
  SELECT 1 FROM conversation existing
  WHERE existing.workspace_id = targets.workspace_id
    AND existing.project_id = targets.project_id
    AND existing.deleted_at IS NULL
    AND existing.title = targets.title
);

WITH chosen AS (
  SELECT id FROM workspace WHERE id::text = current_setting('amplifie.seed_workspace_id')
), desired AS (
  SELECT n, format('Нагрузка · Недавний чат %s', n) AS title
  FROM generate_series(1, 100) AS n
)
INSERT INTO conversation (workspace_id, kind, title, created_at)
SELECT chosen.id, 'channel', desired.title, now() - make_interval(secs => desired.n)
FROM chosen CROSS JOIN desired
WHERE NOT EXISTS (
  SELECT 1 FROM conversation existing
  WHERE existing.workspace_id = chosen.id
    AND existing.project_id IS NULL
    AND existing.deleted_at IS NULL
    AND existing.title = desired.title
);

COMMIT;
