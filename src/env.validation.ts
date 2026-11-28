import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  IsUrl,
  Matches,
  MinLength,
  validateSync,
} from 'class-validator';

// Centralised so a typo at an env-group level cannot sneak in silently.
export const APP_ENVS = ['local', 'preview', 'production'] as const;
export type AppEnv = (typeof APP_ENVS)[number];

export const LOG_LEVELS = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

// Shape of the environment once validated. ConfigService will still return
// strings (its own API) but the validate() hook below guarantees every value
// here is present and well-formed when the app boots.
class EnvironmentVariables {
  @IsOptional()
  @IsInt()
  @IsPositive()
  PORT?: number;

  @IsString()
  DB_HOST: string;

  @IsInt()
  @IsPositive()
  DB_PORT: number;

  @IsString()
  DB_USER: string;

  @IsString()
  DB_PASSWORD: string;

  @IsString()
  DB_NAME: string;

  // 32 chars is the usable floor for a symmetric HMAC secret; our prod values
  // are 48-byte base64 strings, well above this. The check catches a dev who
  // sets JWT_ACCESS_SECRET='hunter2' and nothing else.
  @IsString()
  @MinLength(32)
  JWT_ACCESS_SECRET: string;

  // Format accepted by jsonwebtoken: a number of seconds or a string like
  // '15m', '1h', '30d'. Reject anything else at boot rather than at the first
  // login.
  @IsString()
  @Matches(/^\d+[smhd]?$/)
  JWT_ACCESS_EXPIRES_IN: string;

  @IsInt()
  @IsPositive()
  REFRESH_TOKEN_TTL_DAYS: number;

  // The deployment lane. Added so a Render preview / production build cannot
  // start without a declared env — the same value is the `env` base field on
  // every log line.
  @IsIn(APP_ENVS)
  APP_ENV: AppEnv;

  // Optional; defaults to 'info' at pino-options construction time. Listed
  // here so a typo like LOG_LEVEL=debg fails fast at boot.
  @IsOptional()
  @IsIn(LOG_LEVELS)
  LOG_LEVEL?: LogLevel;

  // 64 hex chars → 32 raw bytes. Fail boot on anything else.
  @IsString()
  @Matches(/^[0-9a-fA-F]{64}$/, {
    message: 'ENCRYPTION_KEY must be exactly 64 hex characters',
  })
  ENCRYPTION_KEY: string;

  // Fyers v3 non-trading app for this environment. Format is <appId>-100.
  @IsString()
  FYERS_APP_ID: string;

  @IsString()
  @MinLength(8)
  FYERS_SECRET: string;

  // Must match exactly what is registered in the Fyers app console; Fyers
  // rejects any variant.
  @IsUrl({ require_tld: false, require_protocol: true })
  FYERS_REDIRECT_URI: string;

  // Where /callback 302s the browser on every outcome. No trailing slash.
  @IsUrl({ require_tld: false, require_protocol: true })
  DARBAR_APP_URL: string;

  // CORS whitelist. Comma-separated list of allowed browser origins. Each
  // entry is either an exact origin ("http://local.darbar.dev:3001") or a
  // /regex/ for preview URLs ("/^https:\\/\\/.*\\.vercel\\.app$/"). Optional:
  // if unset, cross-origin browser requests are rejected (server-to-server
  // and same-origin still work). See src/app.setup.ts.
  @IsOptional()
  @IsString()
  CORS_ORIGINS?: string;

  // Shared secret between Dwarpal and Diwan; 64 hex chars.
  @IsString()
  @Matches(/^[0-9a-fA-F]{64}$/, {
    message: 'SYSTEM_API_KEY must be exactly 64 hex characters',
  })
  SYSTEM_API_KEY: string;
}

export function validateEnv(
  raw: Record<string, unknown>,
): EnvironmentVariables {
  // enableImplicitConversion lets "3307" become 3307, "15" become 15, etc.
  // Without it, every number field would fail @IsInt because env vars arrive
  // as strings.
  const validated = plainToInstance(EnvironmentVariables, raw, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    // Join each failing field's constraint messages so the first boot log
    // clearly states what to fix.
    const summary = errors
      .map(
        (err) =>
          `${err.property}: ${Object.values(err.constraints ?? {}).join(', ')}`,
      )
      .join('\n  ');
    throw new Error(`Environment validation failed:\n  ${summary}`);
  }
  return validated;
}
