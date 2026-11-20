import { plainToInstance } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MinLength,
  validateSync,
} from 'class-validator';

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
}

export function validateEnv(raw: Record<string, unknown>): EnvironmentVariables {
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
      .map((e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`)
      .join('\n  ');
    throw new Error(`Environment validation failed:\n  ${summary}`);
  }
  return validated;
}
