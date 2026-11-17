import { ApiProperty } from '@nestjs/swagger';

export class TokenResponseDto {
  @ApiProperty({
    description:
      'Short-lived JWT bearer token. Sent in Authorization: Bearer <accessToken>.',
  })
  accessToken: string;

  @ApiProperty({
    description: 'Lifetime of the access token in seconds',
    example: 900,
  })
  accessTokenExpiresIn: number;

  @ApiProperty({
    description: 'Opaque refresh token. Submit to /v1/auth/refresh to rotate.',
  })
  refreshToken: string;

  @ApiProperty({
    description: 'Absolute expiry of the refresh token (ISO 8601 UTC)',
    example: '2026-11-24T12:00:00.000Z',
  })
  refreshTokenExpiresAt: string;
}
