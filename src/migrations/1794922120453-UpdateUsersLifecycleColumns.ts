import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateUsersLifecycleColumns1794922120453 implements MigrationInterface {
  name = 'UpdateUsersLifecycleColumns1794922120453';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`users\` ADD \`emailVerifiedAt\` datetime(6) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`users\` ADD \`deletedAt\` datetime(6) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`users\` ADD \`lastUpdatedBy\` varchar(36) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`users\` CHANGE \`phoneNumber\` \`phoneNumber\` varchar(20) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`users\` ADD CONSTRAINT \`FK_users_lastUpdatedBy\` FOREIGN KEY (\`lastUpdatedBy\`) REFERENCES \`users\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const [{ count }] = await queryRunner.query(
      'SELECT COUNT(*) AS count FROM `users` WHERE `phoneNumber` IS NULL',
    );
    if (Number(count) > 0) {
      throw new Error(
        `Cannot revert UpdateUsersLifecycleColumns: ${count} user(s) have no phoneNumber. ` +
          'Making the column NOT NULL would fail. Give them phone numbers first.',
      );
    }

    await queryRunner.query(
      `ALTER TABLE \`users\` DROP FOREIGN KEY \`FK_users_lastUpdatedBy\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`users\` DROP FOREIGN KEY \`FK_users_lastUpdatedBy\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`users\` CHANGE \`phoneNumber\` \`phoneNumber\` varchar(20) NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`users\` DROP COLUMN \`lastUpdatedBy\``,
    );
    await queryRunner.query(`ALTER TABLE \`users\` DROP COLUMN \`deletedAt\``);
    await queryRunner.query(
      `ALTER TABLE \`users\` DROP COLUMN \`emailVerifiedAt\``,
    );
  }
}
