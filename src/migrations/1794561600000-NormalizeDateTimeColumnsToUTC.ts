import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Standardizes every temporal column on DATETIME(6) and forces the session to
 * UTC for the conversion. TIMESTAMP columns previously relied on the server's
 * session timezone; DATETIME columns had inconsistent precision. After this
 * migration, combined with `timezone: 'Z'` in data-source.ts, every stored
 * value is an unambiguous UTC wall-clock with microsecond precision.
 */
export class NormalizeDateTimeColumnsToUTC1794561600000
  implements MigrationInterface
{
  name = 'NormalizeDateTimeColumnsToUTC1794561600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Interpret existing TIMESTAMP values as UTC during the ALTER so the
    // resulting DATETIME strings are the UTC wall-clock, not the server's.
    await queryRunner.query(`SET time_zone = '+00:00'`);

    // users: TIMESTAMP -> DATETIME(6). MySQL reads each TIMESTAMP in the
    // session TZ (UTC, pinned above) and writes the same wall-clock as DATETIME.
    await queryRunner.query(`
      ALTER TABLE \`users\`
      MODIFY COLUMN \`lastLoginAt\` datetime(6) NULL,
      MODIFY COLUMN \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      MODIFY COLUMN \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
    `);

    // refresh_tokens: bump expiresAt and revokedAt to microsecond precision
    // for consistency; createdAt is already datetime(6).
    await queryRunner.query(`
      ALTER TABLE \`refresh_tokens\`
      MODIFY COLUMN \`expiresAt\` datetime(6) NOT NULL,
      MODIFY COLUMN \`revokedAt\` datetime(6) NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET time_zone = '+00:00'`);

    await queryRunner.query(`
      ALTER TABLE \`refresh_tokens\`
      MODIFY COLUMN \`expiresAt\` datetime NOT NULL,
      MODIFY COLUMN \`revokedAt\` datetime NULL
    `);

    await queryRunner.query(`
      ALTER TABLE \`users\`
      MODIFY COLUMN \`lastLoginAt\` timestamp NULL,
      MODIFY COLUMN \`createdAt\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      MODIFY COLUMN \`updatedAt\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
    `);
  }
}
