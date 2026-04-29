import { Injectable } from '@nestjs/common';
import { Markup } from 'telegraf';
import {
  CALLBACK_PREFIX,
  TASK_ACTIONS,
  WORKSPACE_ACTIONS,
  DELETE_ACTIONS,
  CALENDAR_ACTIONS,
  MAX_MESSAGE_LENGTH,
  formatCallbackData,
} from '../telegram.constants';
import { DirectCalendarExtractionResult, TimeBlockSuggestion } from '../../calendar/calendar.types';

/** Status indicator emoji for task display */
const STATUS_INDICATOR: Record<string, string> = {
  captured: '📥',
  active: '🔵',
  in_progress: '🟡',
  done: '✅',
  blocked: '🔴',
  deferred: '⏸️',
};

/**
 * Formats task data into Telegram-compatible HTML messages with inline keyboards.
 *
 * Uses HTML parse_mode (not MarkdownV2) to avoid escaping complexity.
 */
@Injectable()
export class MessageFormatterService {
  /**
   * Format a parent task with its sub-tasks and action buttons.
   * Returns text and extra options for ctx.reply().
   */
  formatTaskBreakdown(
    parentTask: { id: string; title: string; description?: string | null; priority: string; status: string },
    subTasks: Array<{ title: string; status: string; position: number }>,
  ): { text: string; extra: Record<string, unknown> } {
    const lines: string[] = [];

    // Parent task header
    lines.push(`<b>${this.escapeHtml(parentTask.title)}</b>`);
    if (parentTask.description) {
      const desc = parentTask.description.length > 200
        ? parentTask.description.slice(0, 200) + '...'
        : parentTask.description;
      lines.push(`<i>${this.escapeHtml(desc)}</i>`);
    }
    lines.push(`Priority: ${parentTask.priority} | Status: ${parentTask.status}`);
    lines.push('');

    // Sub-tasks list
    if (subTasks.length > 0) {
      lines.push('<b>Sub-tasks:</b>');
      for (const sub of subTasks) {
        const indicator = STATUS_INDICATOR[sub.status] ?? '⚪';
        lines.push(`${sub.position + 1}. ${indicator} ${this.escapeHtml(sub.title)}`);
      }
    }

    let text = lines.join('\n');
    if (text.length > MAX_MESSAGE_LENGTH) {
      text = text.slice(0, MAX_MESSAGE_LENGTH - 3) + '...';
    }

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback(
          '✅ Done',
          formatCallbackData(CALLBACK_PREFIX.TASK, TASK_ACTIONS.DONE, parentTask.id),
        ),
        Markup.button.callback(
          '▶️ Start',
          formatCallbackData(CALLBACK_PREFIX.TASK, TASK_ACTIONS.START, parentTask.id),
        ),
        Markup.button.callback(
          '⏸️ Defer',
          formatCallbackData(CALLBACK_PREFIX.TASK, TASK_ACTIONS.DEFER, parentTask.id),
        ),
        Markup.button.callback(
          '✏️ Edit',
          formatCallbackData(CALLBACK_PREFIX.TASK, TASK_ACTIONS.EDIT, parentTask.id),
        ),
      ],
      [
        Markup.button.callback(
          '📅 Calendar',
          formatCallbackData(CALLBACK_PREFIX.TASK, TASK_ACTIONS.CALENDAR, parentTask.id),
        ),
        Markup.button.callback(
          '⏰ Suggest Time',
          formatCallbackData(CALLBACK_PREFIX.TASK, TASK_ACTIONS.SUGGEST, parentTask.id),
        ),
      ],
    ]);

    return {
      text,
      extra: { parse_mode: 'HTML' as const, ...keyboard },
    };
  }

  /**
   * Format a list of tasks for /tasks command output.
   */
  formatTaskList(
    tasks: Array<{ title: string; status: string; priority: string }>,
  ): string {
    if (tasks.length === 0) {
      return 'No tasks found.';
    }

    const lines = tasks.map((t, i) => {
      const indicator = STATUS_INDICATOR[t.status] ?? '⚪';
      return `${i + 1}. ${indicator} <b>${this.escapeHtml(t.title)}</b> [${t.priority}]`;
    });

    let text = lines.join('\n');
    if (text.length > MAX_MESSAGE_LENGTH) {
      text = text.slice(0, MAX_MESSAGE_LENGTH - 3) + '...';
    }
    return text;
  }

  /**
   * Format a follow-up question for the user.
   */
  formatFollowUpQuestion(question: string): string {
    return `🤔 <b>Quick question:</b>\n\n${this.escapeHtml(question)}`;
  }

  /**
   * Format transcription text before processing.
   */
  formatTranscription(text: string): string {
    return `🎤 <b>I heard:</b>\n<i>${this.escapeHtml(text)}</i>\n\nProcessing...`;
  }

  /**
   * Format time-block suggestions with accept/dismiss buttons.
   */
  formatTimeBlockSuggestions(
    taskTitle: string,
    suggestions: TimeBlockSuggestion[],
  ): { text: string; extra: Record<string, unknown> } {
    const lines: string[] = [
      `⏰ <b>Time Block Suggestions</b> for <i>${this.escapeHtml(taskTitle)}</i>`,
      '',
    ];

    suggestions.forEach((s, i) => {
      lines.push(`${i + 1}. ${s.label}`);
    });

    const buttons = suggestions.map((s, i) =>
      [Markup.button.callback(
        `Accept: ${s.label}`,
        formatCallbackData(CALLBACK_PREFIX.TIMEBLOCK, CALENDAR_ACTIONS.ACCEPT, String(i)),
      )],
    );
    buttons.push([
      Markup.button.callback(
        'Dismiss',
        formatCallbackData(CALLBACK_PREFIX.TIMEBLOCK, CALENDAR_ACTIONS.DISMISS, 'all'),
      ),
    ]);

    const keyboard = Markup.inlineKeyboard(buttons);

    return {
      text: lines.join('\n'),
      extra: { parse_mode: 'HTML' as const, ...keyboard },
    };
  }

  /**
   * Format a workspace selection prompt when the LLM can't determine work vs personal.
   */
  formatWorkspacePrompt(
    taskTitle: string,
    chatId: string,
  ): { text: string; extra: Record<string, unknown> } {
    const text = `Which workspace should this go to?\n\n<b>${this.escapeHtml(taskTitle)}</b>`;

    const keyboard = Markup.inlineKeyboard([
      Markup.button.callback(
        '💼 Work',
        formatCallbackData(CALLBACK_PREFIX.WORKSPACE, WORKSPACE_ACTIONS.WORK, chatId),
      ),
      Markup.button.callback(
        '🏠 Personal',
        formatCallbackData(CALLBACK_PREFIX.WORKSPACE, WORKSPACE_ACTIONS.PERSONAL, chatId),
      ),
    ]);

    return {
      text,
      extra: { parse_mode: 'HTML' as const, ...keyboard },
    };
  }

  /**
   * Format a delete confirmation prompt with Confirm/Cancel buttons.
   */
  formatDeleteConfirmation(
    taskTitle: string,
    taskId: string,
  ): { text: string; extra: Record<string, unknown> } {
    const text = `Delete <b>${this.escapeHtml(taskTitle)}</b> and all its sub-tasks?`;

    const keyboard = Markup.inlineKeyboard([
      Markup.button.callback(
        'Confirm Delete',
        formatCallbackData(CALLBACK_PREFIX.DELETE, DELETE_ACTIONS.CONFIRM, taskId),
      ),
      Markup.button.callback(
        'Cancel',
        formatCallbackData(CALLBACK_PREFIX.DELETE, DELETE_ACTIONS.CANCEL, taskId),
      ),
    ]);

    return {
      text,
      extra: { parse_mode: 'HTML' as const, ...keyboard },
    };
  }

  /**
   * Format a prompt asking the user for an unknown contact's email.
   */
  formatContactPrompt(unknownName: string): string {
    return `I don't have an email for <b>${this.escapeHtml(unknownName)}</b>. Please reply with their email address, or type 'skip' to continue without them.`;
  }

  /**
   * Format a confirmation message after a calendar event is created.
   */
  formatCalendarEventCreated(eventTitle: string, startTime: string): string {
    return `📅 Calendar event created: <b>${this.escapeHtml(eventTitle)}</b>\nScheduled: ${startTime}`;
  }

  /**
   * Format a workspace selection prompt for direct calendar booking.
   */
  formatWorkspacePromptForCalendar(
    eventSummary: string,
    chatId: string,
  ): { text: string; extra: Record<string, unknown> } {
    const text = `Which calendar should this event go on?\n\n📅 <b>${this.escapeHtml(eventSummary)}</b>`;

    const keyboard = Markup.inlineKeyboard([
      Markup.button.callback(
        '💼 Work',
        formatCallbackData(CALLBACK_PREFIX.WORKSPACE, WORKSPACE_ACTIONS.WORK, chatId),
      ),
      Markup.button.callback(
        '🏠 Personal',
        formatCallbackData(CALLBACK_PREFIX.WORKSPACE, WORKSPACE_ACTIONS.PERSONAL, chatId),
      ),
    ]);

    return {
      text,
      extra: { parse_mode: 'HTML' as const, ...keyboard },
    };
  }

  /**
   * Format a direct calendar booking confirmation.
   */
  formatDirectBookingConfirmation(
    summary: string,
    startTimeLabel: string,
    endTimeLabel: string,
    durationMinutes: number,
    attendeeEmails: string[],
  ): string {
    const lines = [
      `📅 <b>Event booked!</b>`,
      ``,
      `<b>${this.escapeHtml(summary)}</b>`,
      `🕐 ${startTimeLabel} — ${endTimeLabel} (${durationMinutes} min)`,
    ];

    if (attendeeEmails.length > 0) {
      lines.push(`👥 ${attendeeEmails.join(', ')}`);
    }

    return lines.join('\n');
  }

  /**
   * Format a conflict message with alternative time suggestions for direct booking.
   */
  formatDirectBookingConflict(
    summary: string,
    suggestions: TimeBlockSuggestion[],
  ): { text: string; extra: Record<string, unknown> } {
    const lines = [
      `⚠️ <b>Time conflict!</b>`,
      `The requested slot for <i>${this.escapeHtml(summary)}</i> is not available.`,
      '',
      '<b>Available alternatives:</b>',
    ];

    suggestions.forEach((s, i) => {
      lines.push(`${i + 1}. ${s.label}`);
    });

    const buttons = suggestions.map((s, i) =>
      [Markup.button.callback(
        `Accept: ${s.label}`,
        formatCallbackData(CALLBACK_PREFIX.TIMEBLOCK, CALENDAR_ACTIONS.ACCEPT, String(i)),
      )],
    );
    buttons.push([
      Markup.button.callback(
        'Cancel',
        formatCallbackData(CALLBACK_PREFIX.TIMEBLOCK, CALENDAR_ACTIONS.DISMISS, 'all'),
      ),
    ]);

    const keyboard = Markup.inlineKeyboard(buttons);

    return {
      text: lines.join('\n'),
      extra: { parse_mode: 'HTML' as const, ...keyboard },
    };
  }

  /**
   * Format a calendar booking confirmation prompt with Confirm/Cancel buttons.
   * Shows extracted details so the user can verify before booking.
   */
  formatCalendarConfirmation(
    extraction: DirectCalendarExtractionResult,
    chatId: string,
    timezone: string,
  ): { text: string; extra: Record<string, unknown> } {
    const lines = [
      `📅 <b>Book this event?</b>`,
      ``,
      `<b>${this.escapeHtml(extraction.summary)}</b>`,
    ];

    if (extraction.date) {
      const dateLabel = new Date(extraction.date + 'T12:00:00').toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        timeZone: timezone,
      });
      lines.push(`📆 ${dateLabel}${extraction.time ? ` at ${extraction.time}` : ''}`);
    }

    if (extraction.duration_minutes) {
      lines.push(`⏱ ${extraction.duration_minutes} min`);
    }

    if (extraction.person_names.length > 0) {
      lines.push(`👥 ${extraction.person_names.join(', ')}`);
    }

    const keyboard = Markup.inlineKeyboard([
      Markup.button.callback(
        '✅ Confirm',
        formatCallbackData(CALLBACK_PREFIX.CALENDAR, CALENDAR_ACTIONS.CONFIRM, chatId),
      ),
      Markup.button.callback(
        '❌ Cancel',
        formatCallbackData(CALLBACK_PREFIX.CALENDAR, CALENDAR_ACTIONS.CANCEL, chatId),
      ),
    ]);

    return {
      text: lines.join('\n'),
      extra: { parse_mode: 'HTML' as const, ...keyboard },
    };
  }

  /**
   * Format the "Note saved" reply with vault path, commit sha, and [Undo] inline button.
   */
  formatNoteSaved(input: {
    noteId: string;
    vaultPath: string;
    commitSha: string;
  }): { text: string; extra: Record<string, unknown> } {
    const shortSha = input.commitSha.slice(0, 7);
    const text =
      `📝 <b>Note saved</b>\n` +
      `<code>${this.escapeHtml(input.vaultPath)}</code>\n` +
      `commit <code>${this.escapeHtml(shortSha)}</code>`;
    const extra = {
      parse_mode: 'HTML' as const,
      ...Markup.inlineKeyboard([
        Markup.button.callback('↩️ Undo', `note:undo:${input.noteId}`),
      ]),
    };
    return { text, extra };
  }

  /**
   * Format the "Note reverted" reply after a successful undo.
   */
  formatNoteReverted(): string {
    return '↩️ <b>Reverted.</b>';
  }

  /**
   * Format the /vault recent list — the last N vault writes with status indicators.
   */
  formatVaultRecent(
    rows: Array<{
      createdAt: Date;
      kind: string;
      vaultPath: string;
      succeeded: boolean;
    }>,
  ): string {
    if (rows.length === 0) return '<i>No vault writes yet.</i>';
    const lines = rows.map((r) => {
      const status = r.succeeded ? '✅' : '❌';
      const when = r.createdAt.toISOString().slice(0, 16).replace('T', ' ');
      return `${status} <code>${when}</code> ${this.escapeHtml(r.vaultPath)}`;
    });
    return `📜 <b>Recent vault writes</b>\n\n${lines.join('\n')}`;
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
