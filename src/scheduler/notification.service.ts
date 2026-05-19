import { Injectable, Logger } from '@nestjs/common';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf, Context, Markup } from 'telegraf';
import { ConfigService } from '@nestjs/config';
import {
  CALLBACK_PREFIX,
  TASK_ACTIONS,
  formatCallbackData,
} from '../telegram/telegram.constants';

/**
 * Sends proactive Telegram notifications for reminders, check-ins, and deferred resurfacing.
 *
 * Uses @InjectBot() to access the Telegraf instance outside of handler context.
 * All messages are sent to the configured OWNER_CHAT_ID.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly ownerChatId: number;

  constructor(
    @InjectBot() private readonly bot: Telegraf<Context>,
    private readonly config: ConfigService,
  ) {
    this.ownerChatId = parseInt(
      this.config.getOrThrow<string>('OWNER_CHAT_ID'),
      10,
    );
  }

  /**
   * Send a deadline reminder with action buttons.
   */
  async sendDeadlineReminder(task: {
    id: string;
    title: string;
    deadline: Date;
  }): Promise<void> {
    const text = [
      '<b>\u23F0 Deadline Reminder</b>',
      '',
      `Task: <b>${this.escapeHtml(task.title)}</b>`,
      `Deadline: ${task.deadline.toLocaleDateString()}`,
    ].join('\n');

    const keyboard = Markup.inlineKeyboard([
      Markup.button.callback(
        '\u2705 Done',
        formatCallbackData(CALLBACK_PREFIX.TASK, TASK_ACTIONS.DONE, task.id),
      ),
      Markup.button.callback(
        '\u25B6\uFE0F Start',
        formatCallbackData(CALLBACK_PREFIX.TASK, TASK_ACTIONS.START, task.id),
      ),
      Markup.button.callback(
        '\u23F8\uFE0F Defer',
        formatCallbackData(CALLBACK_PREFIX.TASK, TASK_ACTIONS.DEFER, task.id),
      ),
    ]);

    await this.bot.telegram.sendMessage(this.ownerChatId, text, {
      parse_mode: 'HTML',
      ...keyboard,
    });

    this.logger.log(`Deadline reminder sent for task ${task.id}`);
  }

  /**
   * Send a check-in prompt for a stale task with action buttons.
   */
  async sendCheckInPrompt(task: {
    id: string;
    title: string;
    updatedAt: Date;
  }): Promise<void> {
    const daysSinceUpdate = Math.floor(
      (Date.now() - task.updatedAt.getTime()) / 86400000,
    );

    const text = [
      '<b>\uD83D\uDCCB Check-in</b>',
      '',
      `How's <b>${this.escapeHtml(task.title)}</b> going?`,
      `It's been ${daysSinceUpdate} days since the last update.`,
    ].join('\n');

    const keyboard = Markup.inlineKeyboard([
      Markup.button.callback(
        '\u2705 Done',
        formatCallbackData(CALLBACK_PREFIX.TASK, TASK_ACTIONS.DONE, task.id),
      ),
      Markup.button.callback(
        'Still working',
        formatCallbackData(CALLBACK_PREFIX.TASK, TASK_ACTIONS.START, task.id),
      ),
      Markup.button.callback(
        'Blocked',
        formatCallbackData(CALLBACK_PREFIX.TASK, TASK_ACTIONS.DEFER, task.id),
      ),
    ]);

    await this.bot.telegram.sendMessage(this.ownerChatId, text, {
      parse_mode: 'HTML',
      ...keyboard,
    });

    this.logger.log(`Check-in prompt sent for task ${task.id}`);
  }

  /**
   * Send a deferred task resurfacing notification with action buttons.
   */
  async sendDeferredResurface(task: {
    id: string;
    title: string;
  }): Promise<void> {
    const text = [
      '<b>\uD83D\uDD04 Task Resurfaced</b>',
      '',
      `<b>${this.escapeHtml(task.title)}</b> was deferred and is now ready for your attention.`,
    ].join('\n');

    const keyboard = Markup.inlineKeyboard([
      Markup.button.callback(
        '\u25B6\uFE0F Start',
        formatCallbackData(CALLBACK_PREFIX.TASK, TASK_ACTIONS.START, task.id),
      ),
      Markup.button.callback(
        '\u2705 Done',
        formatCallbackData(CALLBACK_PREFIX.TASK, TASK_ACTIONS.DONE, task.id),
      ),
      Markup.button.callback(
        '\u23F8\uFE0F Defer',
        formatCallbackData(CALLBACK_PREFIX.TASK, TASK_ACTIONS.DEFER, task.id),
      ),
    ]);

    await this.bot.telegram.sendMessage(this.ownerChatId, text, {
      parse_mode: 'HTML',
      ...keyboard,
    });

    this.logger.log(`Deferred resurfacing sent for task ${task.id}`);
  }

  /**
   * Notify owner that a meeting has been captured to the vault.
   * Format per HLD §3.8 B-MEET-5 + RESEARCH.md MEET-05:
   *   `Meeting captured: "<title>" (<duration>, <N> attendees) → <vault path>`
   * No interactive buttons — informational.
   */
  async sendMeetingCaptured(input: {
    title: string;
    startedAt: Date;
    endedAt: Date;
    attendeeCount: number;
    vaultPath: string;
  }): Promise<void> {
    const duration = NotificationService.formatDuration(input.startedAt, input.endedAt);
    const attendeesLabel =
      input.attendeeCount === 1 ? '1 attendee' : `${input.attendeeCount} attendees`;
    const text = [
      `<b>📝 Meeting captured</b>`,
      ``,
      `"${this.escapeHtml(input.title)}" (${duration}, ${attendeesLabel})`,
      `→ <code>${this.escapeHtml(input.vaultPath)}</code>`,
    ].join('\n');
    await this.bot.telegram.sendMessage(this.ownerChatId, text, { parse_mode: 'HTML' });
    this.logger.log(`Meeting captured notification sent: ${input.vaultPath}`);
  }

  /**
   * Format a duration between two dates.
   * "47 min" if < 60 minutes, "1h 12m" if >= 60 minutes.
   * Public static for unit testing.
   */
  static formatDuration(startedAt: Date, endedAt: Date): string {
    const totalMinutes = Math.max(
      0,
      Math.round((endedAt.getTime() - startedAt.getTime()) / 60_000),
    );
    if (totalMinutes < 60) return `${totalMinutes} min`;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}h ${minutes}m`;
  }

  /**
   * Escape HTML special characters for Telegram HTML parse mode.
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}
