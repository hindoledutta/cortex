import { Module, forwardRef } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from '@nestjs/config';
import { SettingsModule } from '../settings/settings.module';
import { TelegramModule } from '../telegram/telegram.module';
import { SchedulerService } from './scheduler.service';
import { NotificationService } from './notification.service';
import { ReminderService } from './reminder.service';
import { PollingService } from './polling.service';

/**
 * Scheduler module -- pg-boss lifecycle, cron scheduling, and proactive notifications.
 *
 * Imports TelegramModule for @InjectBot() access in NotificationService.
 * ScheduleModule.forRoot() enables @Cron() decorators application-wide.
 * Exports ReminderService for TaskService reminder hooks (via forwardRef).
 */
@Module({
  imports: [
    ScheduleModule.forRoot(),
    ConfigModule,
    SettingsModule,
    forwardRef(() => TelegramModule),
  ],
  providers: [SchedulerService, NotificationService, ReminderService, PollingService],
  exports: [SchedulerService, NotificationService, ReminderService],
})
export class SchedulerModule {}
