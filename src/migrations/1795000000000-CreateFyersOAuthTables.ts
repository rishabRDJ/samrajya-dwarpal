import type { MigrationInterface, QueryRunner } from 'typeorm';

// Written by hand to match the repo's naming convention
// (UQ_/IDX_/FK_<table>_<column>) and to pin the FK cascade behaviour the
// spec requires: CASCADE on fyers_oauth_states.userId (a pending login is
// meaningless without its initiator) and SET NULL on
// fyers_credentials.connectedByUserId (the token belongs to the environment,
// not to the admin who performed the login).
//
// If regenerated via `npm run migration:generate`, diff this file against
// the output and keep the explicit constraint names — TypeORM's auto-names
// drift from the convention and the Migrations CI job will complain.
export class CreateFyersOAuthTables1795000000000 implements MigrationInterface {
  name = 'CreateFyersOAuthTables1795000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`fyers_oauth_states\` (
        \`id\` varchar(36) NOT NULL,
        \`stateHash\` char(64) NOT NULL,
        \`userId\` varchar(36) NOT NULL,
        \`expiresAt\` datetime(6) NOT NULL,
        \`usedAt\` datetime(6) NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        UNIQUE INDEX \`UQ_fyers_oauth_states_stateHash\` (\`stateHash\`),
        INDEX \`IDX_fyers_oauth_states_userId\` (\`userId\`),
        PRIMARY KEY (\`id\`),
        CONSTRAINT \`FK_fyers_oauth_states_userId\` FOREIGN KEY (\`userId\`)
          REFERENCES \`users\` (\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    await queryRunner.query(`
      CREATE TABLE \`fyers_credentials\` (
        \`id\` varchar(36) NOT NULL,
        \`singletonKey\` varchar(32) NOT NULL DEFAULT 'active',
        \`connectedByUserId\` varchar(36) NULL,
        \`encryptedToken\` text NOT NULL,
        \`iv\` varchar(64) NOT NULL,
        \`authTag\` varchar(64) NOT NULL,
        \`keyVersion\` int NOT NULL DEFAULT 1,
        \`expiresAt\` datetime(6) NOT NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
          ON UPDATE CURRENT_TIMESTAMP(6),
        UNIQUE INDEX \`UQ_fyers_credentials_singletonKey\` (\`singletonKey\`),
        PRIMARY KEY (\`id\`),
        CONSTRAINT \`FK_fyers_credentials_connectedByUserId\`
          FOREIGN KEY (\`connectedByUserId\`)
          REFERENCES \`users\` (\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop the child/leaf tables first — neither depends on the other, but
    // dropping in reverse creation order keeps intent clear.
    await queryRunner.query(`DROP TABLE \`fyers_credentials\``);
    await queryRunner.query(`DROP TABLE \`fyers_oauth_states\``);
  }
}
