import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddingRoleColumnUsersTable1794475105719
  implements MigrationInterface
{
  name = 'AddingRoleColumnUsersTable1794475105719';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`users\`
      ADD COLUMN \`role\` ENUM('admin', 'user') NOT NULL DEFAULT 'user' AFTER \`phoneNumber\`
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`users\` DROP COLUMN \`role\``);
  }
}
