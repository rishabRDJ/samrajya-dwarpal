import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUsersTable1794229188277 implements MigrationInterface {
  name = 'CreateUsersTable1794229188277';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`users\` (
        \`id\` varchar(36) NOT NULL,
        \`username\` varchar(64) NOT NULL,
        \`passwordHash\` varchar(255) NOT NULL,
        \`firstName\` varchar(100) NOT NULL,
        \`lastName\` varchar(100) NOT NULL,
        \`emailAddress\` varchar(255) NOT NULL,
        \`phoneNumber\` varchar(20) NOT NULL,
        \`lastLoginAt\` timestamp NULL,
        \`createdAt\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        UNIQUE INDEX \`UQ_users_username\` (\`username\`),
        UNIQUE INDEX \`UQ_users_emailAddress\` (\`emailAddress\`),
        UNIQUE INDEX \`UQ_users_phoneNumber\` (\`phoneNumber\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Dropping the table also drops its indexes.
    await queryRunner.query(`DROP TABLE \`users\``);
  }
}
