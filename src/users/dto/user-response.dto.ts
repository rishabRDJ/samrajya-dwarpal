import { ApiProperty } from '@nestjs/swagger';
import { User, UserRole } from '../user.entity.js';

// Public shape of a user. Deliberately omits passwordHash (never leave the
// server), deletedAt (internal), lastUpdatedBy (internal). Add a field here
// only after deciding it is safe to show every caller of /me and /register.
export class UserResponseDto {
  @ApiProperty({ example: '2b18e2b0-9f3a-4c1d-9c9a-4b0f2b1a1d2e' })
  id: string;

  @ApiProperty({ example: 'rishab', description: 'Lowercased canonical form' })
  username: string;

  @ApiProperty({ example: 'rishab@example.com', description: 'Lowercased canonical form' })
  emailAddress: string;

  @ApiProperty({ example: 'Rishab' })
  firstName: string;

  @ApiProperty({ example: 'Jaiswal' })
  lastName: string;

  @ApiProperty({ type: String, example: null, nullable: true })
  phoneNumber: string | null;

  @ApiProperty({ enum: UserRole, example: UserRole.USER })
  role: UserRole;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  lastLoginAt: Date | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  emailVerifiedAt: Date | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: Date;
}

// Mapper from the entity to the public DTO. Pulling fields explicitly means
// a new PII field on User cannot accidentally leak via register/me response.
export function toUserResponse(user: User): UserResponseDto {
  return {
    id: user.id,
    username: user.username,
    emailAddress: user.emailAddress,
    firstName: user.firstName,
    lastName: user.lastName,
    phoneNumber: user.phoneNumber,
    role: user.role,
    lastLoginAt: user.lastLoginAt,
    emailVerifiedAt: user.emailVerifiedAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
