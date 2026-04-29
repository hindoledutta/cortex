import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerService } from '../scheduler/scheduler.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationService } from '../scheduler/notification.service';
import { HeartbeatService } from './heartbeat.service';

@Injectable()
export class HeartbeatStalenessService implements OnModuleInit {
  private readonly logger = new Logger(HeartbeatStalenessService.name);
  static readonly QUEUE_NAME = 'heartbeat-staleness-check';
  static readonly STALE_THRESHOLD_MS = 26 * 60 * 60 * 1000; // 26h per HLD §3.8 B-MEET-7

  constructor(
    private readonly scheduler: SchedulerService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationService,
    private readonly heartbeat: HeartbeatService,
  ) {}

  async onModuleInit(): Promise<void> {
    const settings = await this.settings.get();
    const hour = settings.notificationHourUtc;          // 0..23
    const cron = `0 ${hour} * * *`;                     // every day at H:00 UTC

    await this.scheduler.boss.createQueue(HeartbeatStalenessService.QUEUE_NAME);
    await this.scheduler.boss.work(HeartbeatStalenessService.QUEUE_NAME, async () => {
      await this.checkStale();
    });
    // schedule() is idempotent on (queueName) — safe to re-run.
    await this.scheduler.boss.schedule(HeartbeatStalenessService.QUEUE_NAME, cron);

    this.logger.log(`Heartbeat staleness check scheduled at cron "${cron}" (UTC)`);
  }

  /** Public for testability — invoked by the pg-boss worker callback. */
  async checkStale(): Promise<void> {
    const cutoff = new Date(Date.now() - HeartbeatStalenessService.STALE_THRESHOLD_MS);
    const stale = await this.heartbeat.findStale(cutoff);
    if (stale.length === 0) {
      this.logger.log('Heartbeat staleness check: all hosts healthy');
      return;
    }
    for (const hb of stale) {
      const hoursAgo = Math.floor((Date.now() - hb.lastSeenAt.getTime()) / 3_600_000);
      try {
        await this.notifications.sendHeartbeatStale({
          host: hb.host,
          hoursAgo,
          lastError: hb.lastError,
        });
      } catch (err) {
        this.logger.error(`Failed to notify stale heartbeat host=${hb.host}: ${String(err)}`);
      }
    }
  }
}
