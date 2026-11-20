import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class RefreshDto {
  @ApiProperty({
    description:
      'Opaque refresh token issued by /v1/auth/login or /v1/auth/refresh',
    example: 'bXktb3BhcXVlLXJlZnJlc2gtdG9rZW4td2l0aC1zdHVmZg',
    minLength: 16,
    maxLength: 512,
  })
  @IsString()
  @Length(16, 512)
  refreshToken: string;
}
