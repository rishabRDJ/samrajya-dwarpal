# Samrajya: Dwarpal (Authentication & IAM Service)

## Overview
Dwarpal acts as the Identity and Access Management (IAM) layer for Project Samrajya. It controls user registration, issues JWTs for internal service authentication, and handles the OAuth flow with the Fyers trading API. It encrypts and stores the Fyers access tokens required by the Diwan trading engine.

## Tech Stack
* Framework: NestJS
* Database: Aiven MySQL
* ORM: TypeORM / Prisma

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
