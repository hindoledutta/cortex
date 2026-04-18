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
   * Escape HTML special characters for Telegram HTML parse mode.
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}
