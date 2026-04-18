import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from './notification.service';
import { SettingsService } from '../settings/settings.service';
import { TaskStatus } from '../../prisma/generated/prisma/client/enums';

/**
 * Daily cron-based polling for stale task check-ins and deferred task resurfacing.
 *
 * Runs every hour and checks if the current UTC hour matches the user's
 * configured notificationHourUtc setting. This avoids timezone issues
 * by running frequently but only acting at the right time.
 */
@Injectable()
export class PollingService {
  private readonly logger = new Logger(PollingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Check for stale in_progress tasks and send check-in prompts.
   * Runs hourly; only acts when current UTC hour matches notificationHourUtc.
   *
   * Skips parent tasks that have recently-updated children (Pitfall 6 avoidance).
   */
  @Cron('0 * * * *')
  async checkStaleTasks() {
    const settings = await this.settings.get();

    // Only run at the configured notification hour
    if (new Date().getUTCHours() !== settings.notificationHourUtc) {
      return;
    }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - settings.checkInAfterDays);

    const staleTasks = await this.prisma.task.findMany({
      where: {
        status: TaskStatus.in_progress,
        updatedAt: { lt: cutoff },
        deletedAt: null,
        parentId: null, // Only parent tasks -- avoid spam for individual sub-tasks
        NOT: {
          children: {
            some: {
              updatedAt: { gte: cutoff },
              deletedAt: null,
            },
          },
        },
      },
    });

    this.logger.log(`Found ${staleTasks.length} stale tasks for check-in`);

    for (const task of staleTasks) {
      try {
        await this.notifications.sendCheckInPrompt(task);
      } catch (err) {
        this.logger.error(
          `Failed to send check-in for task ${task.id}`,
          err instanceof Error ? err.stack : err,
        );
      }
    }
  }

  /**
   * Resurface deferred tasks whose deferredUntil date has passed.
   * Runs hourly; only acts when current UTC hour matches notificationHourUtc.
   *
   * Sends notification FIRST, then updates status (Pitfall 5 avoidance:
   * if notification fails, task stays deferred and retries tomorrow).
   */
  @Cron('0 * * * *')
  async resurfaceDeferredTasks() {
    const settings = await this.settings.get();

    // Only run at the configured notification hour
    if (new Date().getUTCHours() !== settings.notificationHourUtc) {
      return;
    }

    const tasks = await this.prisma.task.findMany({
      where: {
        status: TaskStatus.deferred,
        deferredUntil: { lte: new Date() },
        deletedAt: null,
      },
    });

    this.logger.log(`Found ${tasks.length} deferred tasks to resurface`);

    for (const task of tasks) {
      try {
        // Notification first -- if it fails, task stays deferred, retries tomorrow
        await this.notifications.sendDeferredResurface(task);
        await this.prisma.task.update({
          where: { id: task.id },
          data: { status: TaskStatus.active, deferredUntil: null },
        });
      } catch (err) {
        this.logger.error(
          `Failed to resurface task ${task.id}`,
          err instanceof Error ? err.stack : err,
        );
      }
    }
  }
}
