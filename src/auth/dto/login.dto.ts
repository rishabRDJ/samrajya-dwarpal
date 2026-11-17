import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({
    description: 'Email address or username',
    example: 'rishab@example.com',
    maxLength: 255,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  identifier: string;

  @ApiProperty({
    description: 'Account password',
    example: 'correct horse battery staple',
    minLength: 8,
    maxLength: 128,
  })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;
}
