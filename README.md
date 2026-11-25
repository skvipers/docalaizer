<img src="assets/icon.svg" width="64" height="64" alt="Docalaizer">

# Docalaizer

**Confluence / Coda для эпохи AI-агентов** — сервис документации, структурных диаграмм (Mermaid) и графиков данных (Vega-Lite), где AI-агенты работают через MCP и REST API, но **никогда не перезаписывают ручные правки без явного аппрува**.

## Быстрый старт

### 1. Docker Compose (рекомендуется для self-hosted)

```bash
cp .env.example .env
# Задайте надёжные пароли и URL в .env
docker compose up -d --build
```

После запуска:
- Web UI: `http://localhost:3000`
- API & MCP: `http://localhost:3001` (`/health`, `/api/v1/*`, `/mcp`)

### 2. Локальный запуск (Node.js 20+, pnpm 10+)

```bash
# Поднять только PostgreSQL
docker compose up -d postgres

# Установить зависимости, применить миграции и собрать проект
pnpm install
pnpm build
pnpm db:migrate

# (Опционально) Заполнить демо-данными
# В production обязательно задайте SEED_ADMIN_PASSWORD
pnpm db:seed

# Запуск в production-режиме
pnpm start:api
pnpm start:web

# Или в режиме разработки
pnpm dev
```

Первый зарегистрированный пользователь через `/api/v1/auth/register` (или форму входа) автоматически получает роль `admin`. Публичная регистрация выключена по умолчанию (`ALLOW_PUBLIC_SIGNUP=false`).

## Архитектурная документация

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — общая архитектура системы, модель проектов и дерева страниц, схема БД (PostgreSQL), RBAC и права AI-агентов (`projects:create` и др.), движок диаграмм (Mermaid) и графиков (Vega-Lite).
- [docs/VERSIONING_AND_APPROVAL.md](docs/VERSIONING_AND_APPROVAL.md) — модель версионирования (`Single Timeline + Proposals + Block Ownership`), блочный 3-way merge, политики аппрува и защита ручных правок.
- [docs/API_AND_MCP_SPEC.md](docs/API_AND_MCP_SPEC.md) — контракты MCP-инструментов, формат аннотированного Markdown и спецификация REST API.
- [docs/ROADMAP.md](docs/ROADMAP.md) — поэтапный план реализации (Этапы 0 → 3).
- [AGENTS.md](AGENTS.md) — правила, доменные инварианты и соглашения для AI-агентов, работающих над кодовой базой.

## Вход через LocuGard v0.1.0

Docalaizer поддерживает необязательный вход по WebAuthn/passkey через [LocuGard](https://github.com/skvipers/locugard/tree/v0.1.0), сохраняя обычный вход по email и паролю.

1. Разверните LocuGard по его [integration guide](https://github.com/skvipers/locugard/blob/v0.1.0/docs/INTEGRATION.md) и создайте первого владельца только через локальный CLI.
2. В `AuthService` LocuGard задайте `expected_origin` ровно равным origin веб-приложения Docalaizer, например `https://docalaizer.home.arpa:3000`. `rp_id` должен быть hostname этого приложения или его родительским доменом. WebAuthn не будет работать по HTTP или при другом origin.
3. Настройте API Docalaizer:
   - `LOCUGARD_URL=https://locugard.home.arpa:8443` — HTTPS-адрес HTTP API LocuGard;
   - `LOCUGARD_ORIGIN=https://docalaizer.home.arpa:3000` — тот же origin, что и в `expected_origin`;
   - при использовании собственного CA задайте `NODE_EXTRA_CA_CERTS` с путём к корневому сертификату или запускайте Node.js 22+ с `NODE_OPTIONS=--use-system-ca`, не отключая проверку TLS.
4. Перезапустите API. На экране входа появится кнопка «Войти с passkey через LocuGard».

Аккаунт LocuGard привязывается по `account_id` к локальному пользователю `<account_id>@locugard.invalid` с глобальной ролью `member`; владелец LocuGard автоматически администратором Docalaizer не становится. Upstream-сессия проверяется при каждом авторизованном запросе, поэтому её отзыв блокирует доступ. Токены LocuGard и CSRF хранятся только в Secure HttpOnly-cookie и не попадают в `localStorage`.
