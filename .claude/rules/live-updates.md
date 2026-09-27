---
paths:
  - "backend/src/surface/http/routes/stream.ts"
  - "backend/src/platform/bus.ts"
  - "backend/src/platform/tail.ts"
  - "frontend/src/data/liveStream.ts"
  - "frontend/src/data/useLiveUpdates.ts"
  - "packages/contract/src/stream.ts"
---

# Поток и живые обновления — сначала скилл `centrifugo-realtime`

Правило подгружает движок, когда открыт код потока (task-126). Перед правкой загрузи скилл
`centrifugo-realtime` — там пойманные чужие ошибки живых обновлений и сверка с нашим кодом.
Главное:

- звонок по SSE, содержимое — догоном `/v1/sync` (Р-006); вебсокетов нет;
- «не помню — скажи прямо»: хвост без дыры или отказ в базу, огрызка не бывает;
- цена события не растёт с числом вкладок — доказывает `make event-cost`.
