import { IsOptional, IsString } from 'class-validator';

// Fyers posts all parameters as query strings. All optional because we need
// to accept the error shape (no auth_code) and the success shape (auth_code
// + state) at the same route — the service decides what each case means.
export class FyersCallbackQueryDto {
  @IsOptional()
  @IsString()
  auth_code?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  s?: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  message?: string;
}
