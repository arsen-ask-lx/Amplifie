---
paths:
  - "**/Dockerfile"
  - "compose*.yml"
  - "frontend/Caddyfile"
---

# Образы и compose — сначала скиллы Docker

Правило подгружает движок, когда открыт Dockerfile, compose или Caddyfile (task-126).
Перед правкой загрузи: Dockerfile — `docker-build-strategies`; compose — `docker-compose-patterns`;
любое удаление в Docker — `docker-destructive-guardrails`. Главное:

- `compose.yml` — установка клиента: ни портов наружу, ни дев-настроек; наше — `compose.dev.yml`;
- образы закреплены версией и отпечатком, `latest` нет; не root;
- чужие контейнеры на машине не трогаем.
