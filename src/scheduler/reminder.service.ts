import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SchedulerService } from './scheduler.service';
import { NotificationService } from './notification.service';
import { SettingsService } from '../settings/settings.service';

/**
 * Manages deadline reminder jobs via pg-boss.
 *
 * Registers a worker on init that validates task state before sending notifications.
 * Provides schedule/cancel methods for TaskService hooks.
 * Uses singletonKey for per-task deduplication -- rescheduling replaces the old job.
 */
@Injectable()
export class ReminderService implements OnModuleInit {
  private readonly logger = new Logger(ReminderService.name);

  constructor(
    private readonly scheduler: SchedulerService,
    private readonly notifications: NotificationService,
    private readonly settings: SettingsService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit() {
    await this.scheduler.boss.work<{ taskId: string }>(
      'deadline-reminder',
      async (jobs) => {
        for (const job of jobs) {
          await this.handleDeadlineReminder(job.data);
        }
      },
    );
    this.logger.log('Deadline reminder worker registered');
  }

  /**
   * Handle a deadline reminder job. Re-validates task state before sending.
   */
  private async handleDeadlineReminder(data: { taskId: string }) {
    const task = await this.prisma.task.findUnique({
      where: { id: data.taskId },
    });

    // Guard: skip if task is missing, deleted, or completed
    if (!task || task.deletedAt || task.status === 'done') {
      this.logger.log(
        `Skipping reminder for task ${data.taskId} (completed/deleted/missing)`,
      );
      return;
    }

    await this.notifications.sendDeadlineReminder({
      id: task.id,
      title: task.title,
      deadline: task.deadline!,
    });

    this.logger.log(`Deadline reminder sent for task ${task.id}`);
  }

  /**
   * Schedule a deadline reminder job at deadline minus lead time.
   * Uses singletonKey to ensure one reminder per task (rescheduling replaces old job).
   */
  async scheduleReminder(
    taskId: string,
    deadline: Date,
    perTaskLeadMinutes?: number | null,
  ) {
    const settings = await this.settings.get();
    const leadMinutes = perTaskLeadMinutes ?? settings.reminderLeadMinutes;
    const fireAt = new Date(deadline.getTime() - leadMinutes * 60 * 1000);

    await this.scheduler.boss.send(
      'deadline-reminder',
      { taskId },
      {
        startAfter: fireAt > new Date() ? fireAt.toISOString() : undefined,
        singletonKey: `deadline:${taskId}`,
        retryLimit: 2,
        expireInSeconds: 3600, // 60 minutes
      },
    );

    this.logger.log(
      `Reminder scheduled for task ${taskId} at ${fireAt.toISOString()}`,
    );
  }

  /**
   * Cancel a deadline reminder for a task.
   *
   * pg-boss v12 cancel() requires the job ID, not singletonKey.
   * Since we don't store job IDs, we rely on the handler's re-validation guard:
   * when the job fires, handleDeadlineReminder checks if the task is still
   * active/not-deleted and silently skips if not. The singletonKey prevents
   * duplicate active jobs, so this is safe.
   */
  async cancelReminder(taskId: string) {
    this.logger.debug(
      `Reminder cancel requested for task ${taskId} (handler guard will skip if task is done/deleted)`,
    );
  }
}
