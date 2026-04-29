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
   * Notify owner that a cortex-local heartbeat is overdue.
   * Per HLD §3.8 B-MEET-7: includes hours-since-last-seen + (if available) the daemon's last reported error.
   */
  async sendHeartbeatStale(input: {
    host: string;
    hoursAgo: number;
    lastError?: string | null;
  }): Promise<void> {
    const lines = [
      `<b>⚠️ cortex-local silent</b>`,
      ``,
      `<code>${this.escapeHtml(input.host)}</code> hasn't checked in for <b>${input.hoursAgo}</b> hours.`,
      `Meetily may not be capturing meetings.`,
    ];
    if (input.lastError) {
      lines.push(``);
      lines.push(`Last reported error: <code>${this.escapeHtml(input.lastError.slice(0, 200))}</code>`);
    }
    await this.bot.telegram.sendMessage(this.ownerChatId, lines.join('\n'), { parse_mode: 'HTML' });
    this.logger.log(`Heartbeat-stale notification sent: host=${input.host} hoursAgo=${input.hoursAgo}`);
  }

  /**
   * MEET-06 server-side escalation channel. Fired by HeartbeatService.upsert when the daemon
   * reports a fresh `last_error` (transition from null/different value → new non-null value).
   * The daemon itself has NO Telegram bot token; it surfaces failures through this field.
   *
   * Format (HTML, parse_mode: HTML):
   *   ⚠ <b>cortex-local upload failed</b>
   *
   *   Host: <code>{host}</code>
   *   Last error: <code>{escapeHtml(error)}</code>
   *
   *   Meeting capture is paused. Investigate the daemon log on the Mac mini.
   */
  async sendUploadFailed(input: {
    host: string;
    error: string;
  }): Promise<void> {
    const text = [
      `⚠ <b>cortex-local upload failed</b>`,
      ``,
      `Host: <code>${this.escapeHtml(input.host)}</code>`,
      `Last error: <code>${this.escapeHtml(input.error.slice(0, 500))}</code>`,
      ``,
      `Meeting capture is paused. Investigate the daemon log on the Mac mini.`,
    ].join('\n');
    await this.bot.telegram.sendMessage(this.ownerChatId, text, { parse_mode: 'HTML' });
    this.logger.log(
      `Upload-failed notification sent: host=${input.host} error="${input.error.slice(0, 80)}"`,
    );
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
