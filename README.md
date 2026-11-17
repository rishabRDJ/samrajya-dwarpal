From a8347b096740c54d9830f18cbd7dda50eabbde6c Mon Sep 17 00:00:00 2001
From: Rishab Jaiswal <rishabjaiswal007@gmail.com>
Date: Thu, 12 Nov 2026 21:00:17 +0000
Subject: [PATCH] docs: rewrite README to match current code and roadmap

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018drdHoAPkniCP73NZcVeCm
---
 README.md | 176 ++++++++++++++++++++++++++++++++++++++++++++----------
 1 file changed, 146 insertions(+), 30 deletions(-)

diff --git a/README.md b/README.md
index 7d7dab9..3cda675 100644
--- a/README.md
+++ b/README.md
@@ -1,31 +1,147 @@
-# Samrajya: Dwarpal (Authentication & IAM Service)
-
-## Overview
-Dwarpal acts as the Identity and Access Management (IAM) layer for Project Samrajya. It controls user registration, issues JWTs for internal service authentication, and handles the OAuth flow with the Fyers trading API. It encrypts and stores the Fyers access tokens required by the Diwan trading engine.
-
-## Tech Stack
-* Framework: NestJS
-* Database: Aiven MySQL
-* ORM: TypeORM / Prisma
-
-## Core Responsibilities
-1. User Authentication (Registration / Login via JWT).
-2. Fyers OAuth 2.0 Integration & Token Management.
-3. AES-256 Encryption for stored Fyers API keys.
-
-## Environment Variables Required
-\`\`\`env
-PORT=3001
-DATABASE_URL="mysql://user:pass@host:port/db_name"
-JWT_SECRET="your_secure_jwt_secret"
-ENCRYPTION_KEY="32_byte_aes_key_for_fyers_tokens"
-FYERS_APP_ID="your_fyers_app_id"
-FYERS_APP_SECRET="your_fyers_app_secret"
-FYERS_REDIRECT_URI="http://localhost:3001/auth/fyers/callback"
-\`\`\`
-
-## Run Locally
-\`\`\`bash
+# Samrajya · Dwarpal
+
+**Dwarpal** ("gatekeeper") is the identity and access service of **Project Samrajya**, a single-user paper-trading system for Indian equities built on Smart Money Concepts (SMC). Dwarpal owns user identity, sessions and the daily Fyers access token. No other service talks to Fyers OAuth or holds the encryption key.
+
+> Status: **Phase 1.1 (MVP) in progress.** Schema and migrations are in place; authentication endpoints and the Fyers login chain are being built next. See [Roadmap](#roadmap).
+
+## Where it fits
+
+```mermaid
+flowchart LR
+    B[Browser] --> D[Darbar<br/>Next.js UI on Vercel]
+    D -->|login, refresh, logout| W[Dwarpal<br/>NestJS on Render]
+    W -->|OAuth 2.0 login| F[(Fyers API v3)]
+    W --> M[(MySQL)]
+    V[Diwan<br/>trading engine] -->|system credential:<br/>fetch today's token| W
+    V -->|market data socket| F
+```
+
+| Service | Role |
+|---|---|
+| **Darbar** | Next.js dashboard and the Mantri AI routes |
+| **Dwarpal** (this repo) | Users, JWT sessions, Fyers OAuth, encrypted token storage |
+| **Diwan** | Trading engine: live ticks, candles, SMC detection, paper ledger |
+
+## Tech stack
+
+- **Runtime:** Node.js 20, TypeScript (strict), ES modules
+- **Framework:** NestJS
+- **Database:** MySQL via TypeORM, schema managed only by migrations (`synchronize: false`)
+- **Testing:** Jest
+- **Quality:** oxlint and ESLint, Prettier
+- **CI:** GitHub Actions runs lint, unit tests and build on every pull request and push to `main` and `production`
+- **Hosting:** Render, with separate preview (`main`) and production (`production`) services and per-environment configuration
+
+## Data model
+
+All ids are UUIDs, column names are camelCase, and every time column is `DATETIME(6)` stored in UTC.
+
+**`users`**
+
+| Column | Type | Notes |
+|---|---|---|
+| `id` | varchar(36) | Primary key (UUID) |
+| `username` | varchar(64) | Unique |
+| `passwordHash` | varchar(255) | Excluded from default queries |
+| `firstName`, `lastName` | varchar(100) | |
+| `emailAddress` | varchar(255) | Unique |
+| `phoneNumber` | varchar(20) | Unique |
+| `role` | enum(`admin`, `user`) | Default `user` |
+| `lastLoginAt` | datetime(6) | Null until first login |
+| `createdAt`, `updatedAt` | datetime(6) | Managed by TypeORM |
+
+**`refresh_tokens`**
+
+| Column | Type | Notes |
+|---|---|---|
+| `id` | varchar(36) | Primary key (UUID) |
+| `userId` | varchar(36) | Indexed; foreign key to `users.id`, cascades on delete |
+| `tokenHash` | char(64) | SHA-256 of the raw token, unique. The raw token is never stored |
+| `expiresAt` | datetime(6) | |
+| `createdAt` | datetime(6) | |
+| `revokedAt` | datetime(6) | Null while active; set on rotation, logout or suspected theft |
+
+Planned: `fyers_credentials`, holding the encrypted daily Fyers access token.
+
+## Getting started
+
+Prerequisites: Node.js 20+ and a MySQL 8 database (a local Docker container works).
+
+```bash
 npm install
-npm run start:dev
-\`\`\`
+```
+
+Fill in `.env` with your local settings. The committed file holds placeholders only; never commit real values.
+
+| Variable | Purpose |
+|---|---|
+| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | MySQL connection |
+| `PORT` | HTTP port (defaults to 3000; Render sets it automatically) |
+
+Variables for upcoming features (JWT secrets, `ENCRYPTION_KEY`, `FYERS_APP_ID`, `FYERS_SECRET`, `FYERS_REDIRECT_URI`) will be listed here as each feature lands.
+
+Run the migrations, then start the app:
+
+```bash
+npm run migration:up      # build, then apply pending migrations
+npm run start:dev         # watch mode
+```
+
+Check it is up:
+
+```bash
+curl http://localhost:3000/health   # {"ok":1} when the database is reachable
+```
+
+## Scripts
+
+| Command | What it does |
+|---|---|
+| `npm run start:dev` | Start in watch mode |
+| `npm run build` | Compile to `dist/` |
+| `npm run start:prod` | Run the compiled app |
+| `npm test` | Unit tests (Jest) |
+| `npm run test:e2e` | End-to-end tests |
+| `npm run lint` | oxlint with type-aware rules |
+| `npm run format` | Prettier |
+| `npm run migration:create` | Create an empty migration in `src/migrations` |
+| `npm run migration:up` | Build and apply pending migrations |
+| `npm run migration:down` | Revert the last migration |
+| `npm run migration:show` | List applied and pending migrations |
+
+## API
+
+| Method | Path | Auth | Status |
+|---|---|---|---|
+| GET | `/health` | none | ✅ Liveness and database check; also used by Diwan to wake the service |
+| POST | `/auth/login` | none | 🔜 Short-lived access token plus refresh token in an HttpOnly cookie |
+| POST | `/auth/refresh` | refresh cookie | 🔜 Rotates the refresh token, with reuse detection |
+| POST | `/auth/logout` | refresh cookie | 🔜 Revokes the refresh token |
+| GET | `/users/me` | access token | 🔜 Current user |
+| GET | `/auth/fyers/login-url` | admin | 🔜 Returns the Fyers login URL with a stored `state` |
+| GET | `/auth/fyers/callback` | `state` check | 🔜 Exchanges the auth code and stores the encrypted token |
+| GET | `/internal/fyers-token` | system credential | 🔜 Today's Fyers token for Diwan |
+
+## Security design
+
+Planned behaviour; most of it is being implemented in Phase 1.1.
+
+- Passwords are hashed (argon2 or bcrypt); hashes never leave the service.
+- Only a SHA-256 hash of each refresh token is stored. Tokens rotate on every refresh, and reuse of a rotated token revokes all of that user's sessions.
+- The Fyers access token is encrypted at rest with AES-256 and a fresh random IV on every write, and is never logged.
+- The Fyers login is done manually once a day. Automating the OTP flow is blocked by the exchange, so the system is designed around a daily human login.
+- No secrets live in this public repository; each environment's values live only in its hosting environment.
+
+## Roadmap
+
+Samrajya is built in three phases:
+
+1. **Paper trading.** 1.1 MVP shows live ticks for three stocks behind a login. Later subphases add top gainers and losers, candles and a paper ledger, SMC strategy and backtesting, indicators, news, an AI coach with RAG, UX work, and a profitability gate.
+2. **Live trading** on the owner's account through the Fyers trading app, with risk limits and a kill switch.
+3. **Friends and family**: multi-user access, after the regulatory path is settled.
+
+For Dwarpal, the next steps are password hashing and the JWT session endpoints, then the Fyers OAuth chain, token encryption and the internal token endpoint.
+
+## Contributing
+
+Pull requests go to `main` and need one approval. Only the maintainer merges `main` into `production`. Reference the task ID from the project tracker (for example `DWP-C03`) in commit messages.
-- 
2.43.0