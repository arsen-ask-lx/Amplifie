# Ревью: удаление бесполезных тестов (task-125, шаг 4)

Дата: 2026-09-27. Удаление разрешено владельцем («А, Б, В — удаляй»). Правили три подагента
по непересекающимся зонам; ревью — свежий подагент (Sonnet): для каждого удалённого теста
назвать оставшийся дубль и мутацию, которую ловит и он.

## Файлы и правила ocr

Все — тесты; правила ocr js/ts (опечатки, мёртвый код, дубли, жёсткие значения, `==`, null):
`backend/src/agent/listening/address.test.ts`, `backend/tests/agents.e2e.test.ts`,
`backend/tests/contract.e2e.test.ts`, `backend/tests/projects.e2e.test.ts`,
`backend/tests/stream.e2e.test.ts`, `frontend/src/data/carried.test.ts`,
`frontend/src/data/merge.test.ts`, `frontend/src/screens/talk/markupNodes.test.ts`,
`frontend/src/shared/markup.test.ts`, `frontend/src/shared/searchLine.test.ts`,
`frontend/tests/ui/address.spec.ts`, `frontend/tests/ui/agents.spec.ts`,
`frontend/tests/ui/markup.spec.ts`, `frontend/tests/ui/project-look.spec.ts`,
`frontend/tests/ui/projects.spec.ts`, `frontend/tests/ui/settings.spec.ts`,
`packages/contract/src/mentions.property.test.ts`, `packages/contract/src/mentions.test.ts`,
`tools/load/sse.test.mjs` (удалён).

## Что проверил ревьюер

По каждому удалённому тесту назван дубль в текущем коде и общая мутация: гейт «агент не
отвечает себе» в `address.ts` стоит до разбора текста; `feed.property.test.ts` держит все
семь примеров `merge.test`; `chat.e2e:344` — пустое сообщение; `stream.e2e:122` — звонок
через Caddy строже; `carry.spec:15` — доставка в открытый чат; `projects.spec:100` — перенос
чата в проект. Перенос цвета проекта в `projects.e2e` — литералы сверены с `PROJECT_COLOR`
и дверью `PATCH /v1/projects/:id`. Axe в `markup.spec` читает `violations` и `incomplete`
(белое на белом axe 4.13 кладёт в `incomplete`) — подсадкой доказано, что краснеет.

## Замечания

1. `frontend/tests/ui/projects.spec.ts:229` — высокий — удалён «чат можно отнести в проект из
   рабочего меню» с проверкой принадлежности через сервер, дубля нет — отвергнуто: оставшийся
   `projects.spec.ts:100` идёт теми же шагами (`rowMenu` → «В проект» → ответ PATCH) и
   проверяет ту же принадлежность у сервера (`belonging.channel === belonging.project`)
2. `frontend/tests/ui/projects.spec.ts:194` — средний — вместе с проверкой по CSS-классу ушло
   поведение «закрепление не подменяет значок папки», дубля нет — **принято**: проверка
   возвращена без классов — разметка значков строки до и после закрепления совпадает;
   положительный контроль — ответ двери закрепления и пункт «Открепить»; прогон зелёный

Сверх ревью: имя «выдача кода открывается поверх неподвижной формы ключа» после удаления
проверки координат врало — переименовано в «„Подключить“ открывает окно со строкой запуска
моста» (стандарт, правило 12).

Итог: замечаний 2, принято 1.
