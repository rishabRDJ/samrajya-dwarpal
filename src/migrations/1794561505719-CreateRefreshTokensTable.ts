import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRefreshTokensTable1794561505719
  implements MigrationInterface
{
  name = 'CreateRefreshTokensTable1794561505719';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`refresh_tokens\` (
        \`id\` varchar(36) NOT NULL,
        \`userId\` varchar(36) NOT NULL,
        \`tokenHash\` char(64) NOT NULL,
        \`expiresAt\` datetime NOT NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`revokedAt\` datetime NULL,
        UNIQUE INDEX \`UQ_refresh_tokens_tokenHash\` (\`tokenHash\`),
        INDEX \`IDX_refresh_tokens_userId\` (\`userId\`),
        PRIMARY KEY (\`id\`),
        CONSTRAINT \`FK_refresh_tokens_userId\` FOREIGN KEY (\`userId\`)
          REFERENCES \`users\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`refresh_tokens\``);
  }
}
