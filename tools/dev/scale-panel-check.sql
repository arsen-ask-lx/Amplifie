-- Арбитр сида панели. Запуск: make scale-check.
-- Проверяет именно помеченные тестовые данные, рабочие чаты не учитывает.
\set ON_ERROR_STOP on

SELECT set_config('amplifie.seed_workspace_id', :'workspace_id', false);

DO $$
DECLARE
  wid uuid;
  project_total integer;
  loose_total integer;
  project_chat_total integer;
BEGIN
  SELECT id INTO wid FROM workspace WHERE id::text = current_setting('amplifie.seed_workspace_id');
  IF wid IS NULL THEN
    RAISE EXCEPTION 'тестовое пространство не найдено';
  END IF;

  SELECT count(*) INTO project_total
  FROM project
  WHERE workspace_id = wid AND deleted_at IS NULL AND title LIKE 'Нагрузка · Проект %';
  IF project_total <> 100 THEN
    RAISE EXCEPTION 'ожидалось 100 тестовых проектов, найдено %', project_total;
  END IF;

  SELECT count(*) INTO loose_total
  FROM conversation
  WHERE workspace_id = wid AND deleted_at IS NULL AND project_id IS NULL
    AND title LIKE 'Нагрузка · Недавний чат %';
  IF loose_total <> 100 THEN
    RAISE EXCEPTION 'ожидалось 100 тестовых чатов вне проектов, найдено %', loose_total;
  END IF;

  SELECT count(*) INTO project_chat_total
  FROM conversation
  WHERE workspace_id = wid AND deleted_at IS NULL AND project_id IS NOT NULL
    AND title LIKE 'Нагрузка · Чат %';
  IF project_chat_total <> 5140 THEN
    RAISE EXCEPTION 'ожидалось 5140 тестовых чатов в проектах, найдено %', project_chat_total;
  END IF;
END $$;
