import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class AppService implements OnModuleInit {
  private readonly logger = new Logger(AppService.name);

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit() {
    const rows: { ok: number }[] = await this.dataSource.query(
      'SELECT 1 AS ok',
    );
    this.logger.log(`Aiven MySQL health check: ${JSON.stringify(rows)}`);
  }

  getHello(): string {
    return 'Hello World!';
  }

  async checkDatabase(): Promise<{ ok: number }> {
    const rows: { ok: number }[] = await this.dataSource.query(
      'SELECT 1 AS ok',
    );
    return rows[0];
  }
}
