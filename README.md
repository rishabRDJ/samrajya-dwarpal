# Samrajya: Dwarpal (Authentication & IAM Service)

## Overview

Dwarpal acts as the Identity and Access Management (IAM) layer for Project Samrajya. It controls user registration, issues JWTs for internal service authentication, and handles the OAuth flow with the Fyers trading API. It encrypts and stores the Fyers access tokens required by the Diwan trading engine.

## Tech Stack

- Framework: NestJS
- Database: Aiven MySQL
- ORM: TypeORM / Prisma

## Core Responsibilities

1. User Authentication (Registration / Login via JWT).
2. Fyers OAuth 2.0 Integration & Token Management.
3. AES-256 Encryption for stored Fyers API keys.

## Environment Variables Required

\`\`\`env
PORT=3001
DATABASE_URL="mysql://user:pass@host:port/db_name"
JWT_SECRET="your_secure_jwt_secret"
ENCRYPTION_KEY="32_byte_aes_key_for_fyers_tokens"
FYERS_APP_ID="your_fyers_app_id"
FYERS_APP_SECRET="your_fyers_app_secret"
FYERS_REDIRECT_URI="http://localhost:3001/auth/fyers/callback"
\`\`\`

## Run Locally

\`\`\`bash
npm install
npm run start:dev
\`\`\`

## API docs

`GET /docs` serves Swagger UI and `GET /docs-json` serves the raw OpenAPI document. Both are public so the docs can be linked from a CV. In the production env the "Try it out" button is disabled (`supportedSubmitMethods: []`) so anonymous visitors can't fire requests from the docs page — share the **preview** URL if you want readers to be able to try endpoints interactively.

## Logging

Dwarpal emits one-line JSON logs via [nestjs-pino](https://github.com/iamolegga/nestjs-pino). Every line carries a fixed set of base fields plus event-specific details, so the three Samrajya services (Dwarpal, Diwan, Darbar) can be searched together by `service`, `env` and `reqId`.

### Fields on every line

| Field | Source | Example |
| --- | --- | --- |
| `service` | pino base | `"dwarpal"` |
| `env` | `APP_ENV` env var | `"local" \| "preview" \| "production"` |
| `level` | pino level | `30` (info), `40` (warn), `50` (error) |
| `time` | pino | epoch ms |
| `context` | `ScopedLogger` | `"AuthService.login"` — `ClassName.method` of the call site |
| `reqId` | pino-http + `ScopedLogger` | UUID or echoed `x-request-id`. Present on every log emitted DURING a request; absent for startup, migrations and workers (expected) |

The HTTP request-completion line is emitted by `pino-http` automatically. Business events — logins, token reuse, admin actions — are emitted by services through `ScopedLogger`.

### Event naming

All business events follow `domain.action.outcome`:

| Domain | Examples |
| --- | --- |
| `auth.*` | `auth.login.succeeded`, `auth.login.failed`, `auth.register.succeeded`, `auth.register.conflict`, `auth.refresh.succeeded`, `auth.refresh.rejected`, `auth.refresh.reuse_detected`, `auth.logout` |
| `user.*` | `user.password.changed`, `user.password.change_failed`, `user.profile.updated`, `user.profile.update_failed` |
| `admin.*` | `admin.users.listed`, `admin.role.changed`, `admin.role.unchanged`, `admin.role.blocked_self`, `admin.role.blocked_last_admin`, `admin.user.deleted`, `admin.user.delete_blocked`, `admin.user.restored`, `admin.user.restore_blocked` |

See `src/auth/*.service.ts`, `src/users/users.service.ts` and `src/admin/admin-users.service.ts` for the exact shape each event carries.

### Request IDs end-to-end

Every HTTP response carries an `x-request-id` header. The server:
- reuses an incoming `x-request-id` when it matches `/^[A-Za-z0-9-]{8,64}$/`, so an upstream service can set it and the two logs cross-reference,
- otherwise generates a new UUID via `crypto.randomUUID()`,
- echoes the chosen id back in the response header,
- and attaches it as `reqId` on every log line emitted during that request.

### Redaction

The following fields are replaced with `[REDACTED]` wherever they appear, at any depth:

- Request headers: `authorization`, `cookie`
- Response headers: `set-cookie`
- Field names: `password`, `currentPassword`, `newPassword`, `passwordHash`, `refreshToken`, `accessToken`, `tokenHash`

Request URLs are logged without the query string so `GET /v1/auth/availability?emailAddress=…` does not leak PII into logs.

### What is NOT logged

- Request or response bodies
- Raw passwords, tokens or hashes
- The query string portion of any URL

### Lines outside a request context

Lines emitted during startup, migrations (`npm run migration:up`), and any future cron or queue worker have no `reqId` — this is intentional. For workers, add a correlation field yourself (e.g. `trade_id`, `batch_id`) when calling the logger.

### New env variables

- `APP_ENV` — the deployment lane. Required. One of `local`, `preview`, `production`. Startup fails without it. `local` emits pretty-formatted lines via `pino-pretty`; `preview` and `production` emit raw JSON.
- `LOG_LEVEL` — optional pino level override. Defaults to `info`. Values: `fatal | error | warn | info | debug | trace | silent`.
