import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PgBoss } from 'pg-boss';

/**
 * Manages pg-boss lifecycle with NestJS application lifecycle.
 *
 * Creates the 'deadline-reminder' queue on startup.
 * Uses minimal connection pool (max: 2) for Neon free tier compatibility.
 */
@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  readonly boss: PgBoss;

  constructor(private readonly config: ConfigService) {
    this.boss = new PgBoss({
      connectionString: this.config.getOrThrow<string>('DATABASE_URL'),
      max: 2,
      monitorIntervalSeconds: 600,
    });
  }

  async onModuleInit() {
    this.boss.on('error', (error: Error) =>
      this.logger.error('pg-boss error', error),
    );
    await this.boss.start();
    await this.boss.createQueue('deadline-reminder');
    this.logger.log('pg-boss started');
  }

  async onModuleDestroy() {
    await this.boss.stop({ graceful: true });
    this.logger.log('pg-boss stopped');
  }
}
