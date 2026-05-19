import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Context } from 'telegraf';
import { randomUUID } from 'crypto';
import { VaultService } from '../../vault/vault.service';
import { NoteService } from '../../note/note.service';
import { SlugService } from '../../llm/slug.service';
import { ClassificationService } from '../../llm/classification.service';
import { DecompositionService } from '../../llm/decomposition.service';
import { FollowUpService } from '../../llm/follow-up.service';
import {
  EnrichmentService,
  ExistingTaskInfo,
} from '../../llm/enrichment.service';
import { CommentProcessingService } from '../../llm/comment-processing.service';
import { CalendarExtractionService } from '../../llm/calendar-extraction.service';
import { DirectCalendarExtractionService } from '../../llm/direct-calendar-extraction.service';
import { DecompositionResult } from '../../llm/llm.types';
import { SessionService } from '../../session/session.service';
import { SessionState } from '../../session/session.types';
import { TaskService } from '../../task/task.service';
import { WorkspaceService } from '../../workspace/workspace.service';
import { CommentService } from '../../comment/comment.service';
import { CalendarService } from '../../calendar/services/calendar.service';
import { ContactService } from '../../calendar/services/contact.service';
import { TimeBlockService } from '../../calendar/services/time-block.service';
import { VoiceService } from './voice.service';
import { MessageFormatterService } from './message-formatter.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  TaskPriority,
  TaskStatus,
  WorkspaceName,
} from '../../../prisma/generated/prisma/client/enums';
import {
  CalendarExtractionResult,
  DirectCalendarExtractionResult,
  TimeBlockSuggestion,
} from '../../calendar/calendar.types';

// ── Timezone helpers ────────────────────────────────────────────────────────
// These use the built-in Intl API so we don't need an external library.

/**
 * Convert a date + time string (representing local time in `timezone`)
 * into a proper UTC Date object.
 *
 * Example: localTimeToUtcDate('2025-07-23', '17:00', 'Asia/Kolkata')
 *  → Date representing 2025-07-23T11:30:00Z (5 PM IST = 11:30 AM UTC)
 */
function localTimeToUtcDate(
  dateStr: string,
  timeStr: string,
  timezone: string,
): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [h, min] = timeStr.split(':').map(Number);

  // Initial guess: treat the components as UTC
  const guessUtc = Date.UTC(y, m - 1, d, h, min, 0);

  // See what that UTC instant looks like in the target timezone (sv-SE gives ISO-ish format)
  const inTz = new Date(guessUtc).toLocaleString('sv-SE', { timeZone: timezone });
  const guessInTz = new Date(inTz + 'Z').getTime();

  // The difference is the timezone offset: offset = guessUtc - guessInTz
  // Apply it so the result represents the correct UTC instant for the local time.
  return new Date(guessUtc + (guessUtc - guessInTz));
}

/**
 * Get the decimal hour (e.g. 9.5 for 9:30 AM) of a Date in a given timezone.
 */
function getHourDecimalInTz(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
    timeZone: timezone,
  }).formatToParts(date);
  const hour = parseInt(parts.find((p) => p.type === 'hour')!.value, 10);
  const minute = parseInt(parts.find((p) => p.type === 'minute')!.value, 10);
  return hour + minute / 60;
}

/**
 * Return a new Date set to a specific hour:minute in the user's timezone,
 * keeping the same calendar date as `refDate` shows in that timezone.
 */
function setHoursInTz(
  refDate: Date,
  hours: number,
  minutes: number,
  timezone: string,
): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour12: false,
    timeZone: timezone,
  }).formatToParts(refDate);
  const year = parts.find((p) => p.type === 'year')!.value;
  const month = parts.find((p) => p.type === 'month')!.value;
  const day = parts.find((p) => p.type === 'day')!.value;
  const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  return localTimeToUtcDate(`${year}-${month}-${day}`, timeStr, timezone);
}

// ── End timezone helpers ────────────────────────────────────────────────────

/** Pending contact resolution state for calendar event creation flow. */
interface PendingContactResolution {
  taskId: string;
  resolvedEmails: string[];
  unresolvedNames: string[];
  extraction: CalendarExtractionResult;
}

/**
 * Central coordination service for all Telegram message flows.
 *
 * Handles text classification -> decomposition -> follow-up,
 * voice transcription -> auto-process, callback -> status update,
 * reply-to -> comment + action items, calendar event creation,
 * time-block suggestions, and all /commands.
 */
@Injectable()
export class OrchestratorService {
  private readonly logger = new Logger(OrchestratorService.name);

  /** In-memory store for pending contact resolutions, keyed by chatId. */
  private pendingContactResolutions = new Map<string, PendingContactResolution>();

  /** In-memory store for pending time-block suggestions, keyed by chatId. */
  private pendingTimeBlocks = new Map<string, {
    taskId: string;
    suggestions: TimeBlockSuggestion[];
    summary?: string;
    calendarId?: string;
  }>();

  /** In-memory store for pending workspace selections, keyed by chatId. */
  private pendingWorkspaceSelections = new Map<string, { text: string; result: DecompositionResult }>();

  /** In-memory store for pending direct calendar bookings awaiting workspace selection. */
  private pendingDirectBookings = new Map<string, { text: string; extraction: DirectCalendarExtractionResult }>();

  /** In-memory store for pending note voice sessions, keyed by chatId. */
  private pendingNoteVoiceSessions = new Map<
    string, // chatId
    { workspaceId: string; expiresAt: Date }
  >();

  private static readonly NOTE_VOICE_TTL_MS = 5 * 60 * 1000; // 5 min
  private static readonly NOTE_VOICE_MAX_DURATION_S = 600; // 10 min hard cap (NOTE-08)
  private static readonly UNDO_WINDOW_MS = 60 * 1000; // 60 sec (NOTE-06, NOTE-07)

  constructor(
    private readonly classification: ClassificationService,
    private readonly decomposition: DecompositionService,
    private readonly followUp: FollowUpService,
    private readonly enrichment: EnrichmentService,
    private readonly commentProcessing: CommentProcessingService,
    private readonly calendarExtraction: CalendarExtractionService,
    private readonly directCalendarExtraction: DirectCalendarExtractionService,
    private readonly session: SessionService,
    private readonly taskService: TaskService,
    private readonly workspace: WorkspaceService,
    private readonly commentService: CommentService,
    private readonly calendarService: CalendarService,
    private readonly contactService: ContactService,
    private readonly timeBlockService: TimeBlockService,
    private readonly voice: VoiceService,
    private readonly formatter: MessageFormatterService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly vault: VaultService,
    private readonly noteService: NoteService,
    private readonly slugService: SlugService,
  ) {}

  /**
   * Handle incoming text messages.
   * Detects reply-to (comment), classifies intent, routes accordingly.
   */
  async handleText(ctx: Context): Promise<void> {
    try {
      const chatId = String(ctx.chat!.id);
      const message = ctx.message as Record<string, any>;
      const text: string = message.text;

      // Pending contact resolution: intercept text if we're awaiting an email
      const pending = this.pendingContactResolutions.get(chatId);
      if (pending && pending.unresolvedNames.length > 0) {
        await this.handleContactResponse(ctx, chatId, text, pending);
        return;
      }

      // Reply-to detection first: if replying to a bot message, treat as comment
      if (message.reply_to_message?.from?.is_bot) {
        const replyMsgId = message.reply_to_message.message_id;
        const task = await this.commentService.findTaskByTelegramMsgId(
          BigInt(replyMsgId),
        );
        if (task) {
          await this.handleComment(ctx, task, text);
          return;
        }
      }

      await this.classifyAndRoute(ctx, chatId, text);
    } catch (error) {
      this.logger.error(`Error handling text message: ${error}`);
      await ctx.reply(this.formatProcessingError(error));
    }
  }

  /**
   * Handle incoming voice messages.
   * Short-circuits to note-voice flow if a pending note session exists for this chat.
   * Otherwise transcribes via Whisper, shows transcription, then classifies and routes.
   */
  async handleVoice(ctx: Context): Promise<void> {
    const chatId = String(ctx.chat!.id);
    const message = ctx.message as Record<string, any>;
    const voice = message.voice;

    // NOTE-08: 10-min cap enforced BEFORE Whisper to avoid burning $$ on rejected audio.
    // Short-circuit to note voice handler if a pending note session exists.
    const noteSession = this.pendingNoteVoiceSessions.get(chatId);
    if (noteSession && noteSession.expiresAt > new Date()) {
      this.pendingNoteVoiceSessions.delete(chatId);
      if (voice?.duration && voice.duration > OrchestratorService.NOTE_VOICE_MAX_DURATION_S) {
        await ctx.reply(
          '⏱️ Voice notes are capped at 10 minutes. Please send a shorter clip.',
        );
        return;
      }
      return this.handleNoteVoice(ctx, chatId, noteSession.workspaceId);
    }

    let transcription: string | null = null;

    try {
      await ctx.sendChatAction('typing');

      const fileLink = await ctx.telegram.getFileLink(voice.file_id);

      transcription = await this.voice.transcribe(fileLink);

      await ctx.reply(this.formatter.formatTranscription(transcription), {
        parse_mode: 'HTML',
      });
    } catch (error) {
      this.logger.error(`Error transcribing voice message: ${error}`);
      await ctx.reply(
        'Sorry, I couldn\'t process your voice message. Please try again or send text instead.',
      );
      return;
    }

    // Classify and route transcription (same as text flow)
    try {
      const chatId = String(ctx.chat!.id);
      await this.classifyAndRoute(ctx, chatId, transcription);
    } catch (error) {
      this.logger.error(`Error processing voice transcription: ${error}`);
      await ctx.reply(this.formatProcessingError(error));
    }
  }

  /**
   * Handle the /note command in its three forms:
   * 1. /note <text>  — inline text note
   * 2. /note (bare)  — arms a pending voice session
   * 3. /note (reply to transcription) — saves the replied-to transcript as a note
   *
   * NOTE-09 compliance: does NOT call classifyAndRoute, session.refreshTtl, or
   * modify any pending follow-up state — the note side-channel is fully isolated.
   */
  async handleNoteCommand(ctx: Context): Promise<void> {
    try {
      const chatId = String(ctx.chat!.id);
      const message = ctx.message as Record<string, any>;
      const rawText: string = (message.text ?? '').replace(/^\/note(@\w+)?\s*/, '');

      // Form 3: reply to a previously transcribed voice message
      const replyTo = message.reply_to_message;
      if (replyTo?.from?.is_bot && typeof replyTo.text === 'string') {
        const transcript = this.extractTranscriptFromTranscriptionMessage(replyTo.text);
        if (transcript) {
          const { workspace, body } = this.parseWorkspacePrefix(transcript);
          const wsId = workspace
            ? (await this.workspace.findByName(workspace as any))?.id
            : (await this.workspace.getDefault()).id;
          if (!wsId) {
            await ctx.reply('Could not resolve workspace for note.');
            return;
          }
          await this.persistNote(ctx, { workspaceId: wsId, source: 'voice', body });
          return;
        }
      }

      // Form 1: /note <text>
      if (rawText.length > 0) {
        const { workspace, body } = this.parseWorkspacePrefix(rawText);
        const wsId = workspace
          ? (await this.workspace.findByName(workspace as any))?.id
          : (await this.workspace.getDefault()).id;
        if (!wsId) {
          await ctx.reply('Could not resolve workspace for note.');
          return;
        }
        await this.persistNote(ctx, { workspaceId: wsId, source: 'text', body });
        return;
      }

      // Form 2: bare /note → arm pending voice session
      const ws = await this.workspace.getDefault();
      this.pendingNoteVoiceSessions.set(chatId, {
        workspaceId: ws.id,
        expiresAt: new Date(Date.now() + OrchestratorService.NOTE_VOICE_TTL_MS),
      });
      await ctx.reply('🎤 Send your voice message — I\'ll save it as a note. (5-min window)');
    } catch (error) {
      this.logger.error(`Error handling /note: ${error}`);
      await ctx.reply(this.formatProcessingError(error));
    }
  }

  /**
   * Handle /vault command — shows the last 10 vault writes.
   */
  async handleVaultRecentCommand(ctx: Context): Promise<void> {
    try {
      const rows = await this.prisma.vaultWrite.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
      const text = this.formatter.formatVaultRecent(rows);
      await ctx.reply(text, { parse_mode: 'HTML' });
    } catch (error) {
      this.logger.error(`Error fetching vault recent: ${error}`);
      await ctx.reply(this.formatProcessingError(error));
    }
  }

  /**
   * Handle note:undo:{noteId} callback — reverts the vault commit and soft-deletes the Note row.
   */
  async handleNoteUndoCallback(ctx: Context): Promise<void> {
    try {
      const data = (ctx.callbackQuery as any)?.data as string | undefined;
      const match = data?.match(/^note:undo:(.+)$/);
      if (!match) {
        await ctx.answerCbQuery('Bad callback');
        return;
      }
      const noteId = match[1];
      const note = await this.noteService.findById(noteId);
      if (!note) {
        await ctx.answerCbQuery('Note not found');
        return;
      }
      if (note.deletedAt) {
        await ctx.answerCbQuery('Already undone');
        return;
      }
      const ageMs = Date.now() - note.createdAt.getTime();
      if (ageMs > OrchestratorService.UNDO_WINDOW_MS) {
        await ctx.answerCbQuery('Undo window expired');
        return;
      }
      if (!note.vaultCommitSha) {
        await ctx.answerCbQuery('No commit to revert');
        return;
      }

      await this.vault.revertLastCommit(note.vaultCommitSha);
      await this.noteService.softDelete(noteId);

      await ctx.answerCbQuery('Reverted');
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] }); // remove the [Undo] button
      await ctx.reply(this.formatter.formatNoteReverted(), { parse_mode: 'HTML' });
    } catch (error) {
      this.logger.error(`Error handling note undo: ${error}`);
      await ctx.answerCbQuery('Undo failed — vault may have moved on');
    }
  }

  /**
   * Handle note voice — invoked from handleVoice when a pending note session matched.
   * Transcribes via Whisper then calls persistNote with the transcript.
   */
  private async handleNoteVoice(ctx: Context, chatId: string, workspaceId: string): Promise<void> {
    try {
      await ctx.sendChatAction('typing');
      const message = ctx.message as Record<string, any>;
      const fileLink = await ctx.telegram.getFileLink(message.voice.file_id);
      const transcript = await this.voice.transcribe(fileLink);
      await this.persistNote(ctx, { workspaceId, source: 'voice', body: transcript });
    } catch (error) {
      this.logger.error(`Error handling note voice: ${error}`);
      await ctx.reply('Sorry, I couldn\'t process that voice note. Please try again.');
    }
  }

  /**
   * Shared core for all note persistence: slug → vault write → DB row → Telegram reply with [Undo].
   * Never throws externally — errors are caught and surfaced as user-facing messages.
   */
  private async persistNote(
    ctx: Context,
    input: { workspaceId: string; source: 'text' | 'voice'; body: string },
  ): Promise<void> {
    const { workspaceId, source, body } = input;
    const ws = await this.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });

    // 1. Generate slug (Sonnet — falls back internally on failure, never throws).
    const slug = await this.slugService.generate(body);

    // 2. Build vault path + file body with Source/Captured/Workspace header (NOTE-04).
    const dateStr = new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD
    const vaultPath = `raw/inbox/${dateStr}-${slug}.md`;
    const fileBody =
      `Source: Telegram (${source})\n` +
      `Captured: ${new Date().toISOString()}\n` +
      `Workspace: ${ws.name === 'work' ? 'Work' : 'Personal'}\n` +
      `\n---\n\n` +
      body;

    // 3. Use a pre-generated noteId so the vault audit row can reference the note
    //    and we can wire the [Undo] callback before knowing the commit SHA.
    const noteId = randomUUID();

    try {
      const writeResult = await this.vault.writeFile({
        vaultPath,
        body: fileBody,
        commitMessage: `note: capture ${slug}`,
        kind: 'note',
        sourceId: noteId,
      });

      // 4. Persist the Note row with the actual commit sha + post-collision vault path.
      await this.prisma.note.create({
        data: {
          id: noteId,
          workspaceId,
          source,
          body,
          slug,
          vaultPath: writeResult.vaultPath,
          vaultCommitSha: writeResult.commitSha,
        },
      });

      // 5. Reply with [Undo] inline keyboard.
      const { text, extra } = this.formatter.formatNoteSaved({
        noteId,
        vaultPath: writeResult.vaultPath,
        commitSha: writeResult.commitSha,
      });
      const sentMsg = await ctx.reply(text, extra as any);

      // 6. Schedule keyboard removal at 60s (NOTE-06).
      // Using .unref() so the timer does not prevent process shutdown.
      const timer = setTimeout(() => {
        ctx.telegram
          .editMessageReplyMarkup(
            sentMsg.chat.id,
            sentMsg.message_id,
            undefined,
            { inline_keyboard: [] }, // NOT empty object — Telegram returns 400 otherwise
          )
          .catch((err: unknown) => {
            const msg = String(err);
            if (!msg.includes('message is not modified')) {
              this.logger.warn(`Failed to clear undo keyboard: ${msg}`);
            }
          });
      }, OrchestratorService.UNDO_WINDOW_MS);
      timer.unref();
    } catch (err) {
      this.logger.error(`Vault write failed for note ${noteId}: ${err}`);
      await ctx.reply(`❌ Failed to save note: ${String(err).slice(0, 200)}`);
    }
  }

  /**
   * Strip Telegram HTML and the formatTranscription chrome to recover the original transcript.
   * Matches the output of MessageFormatterService.formatTranscription().
   */
  private extractTranscriptFromTranscriptionMessage(text: string): string | null {
    // Telegram's reply_to_message.text is the plain-text rendering (HTML tags stripped),
    // but the chrome from formatTranscription remains: "🎤 I heard:\n<body>\n\nProcessing..."
    const match = text.match(/I heard:\s*\n([\s\S]+?)\n\nProcessing\.\.\./);
    return match ? match[1].trim() : null;
  }

  /**
   * Parse @work / @personal prefix from the start of a note body.
   * Returns the workspace name (if any) and the stripped body.
   */
  private parseWorkspacePrefix(text: string): {
    workspace: 'work' | 'personal' | null;
    body: string;
  } {
    const m = text.match(/^@(work|personal)\s+([\s\S]+)$/i);
    if (m) return { workspace: m[1].toLowerCase() as 'work' | 'personal', body: m[2].trim() };
    return { workspace: null, body: text.trim() };
  }

  /**
   * Classify a message and route to the appropriate handler.
   * Shared by handleText() and handleVoice().
   */
  private async classifyAndRoute(
    ctx: Context,
    chatId: string,
    text: string,
  ): Promise<void> {
    // Get or create session
    const { session } = await this.session.getOrCreate(chatId);
    await this.session.refreshTtl(chatId);

    // Get pending follow-ups from session
    const pendingFollowUps =
      session.activeTopic?.pendingFollowUps ?? [];

    // Classify the message intent
    const classification = await this.classification.classify(
      text,
      pendingFollowUps,
    );

    // Route based on intent
    switch (classification.intent) {
      case 'new_brain_dump':
        await this.handleBrainDump(ctx, chatId, text);
        break;
      case 'follow_up_answer':
        await this.handleFollowUpAnswer(ctx, chatId, text, session);
        break;
      case 'task_action':
        await this.handleTaskAction(ctx, chatId, session);
        break;
      case 'calendar_event':
        await this.handleDirectCalendarBooking(ctx, chatId, text);
        break;
      case 'command':
        await ctx.reply(
          'Use /tasks, /workspace, /help, or /settings',
        );
        break;
      case 'unclear':
        await ctx.reply(
          'I\'m not sure what you mean. Try sending a brain dump (describe what you need to do) or use /help to see available commands.',
        );
        break;
    }
  }

  /**
   * Handle inline keyboard callback button presses.
   * Parses action/taskId from regex match, updates task status or enters edit mode.
   */
  async handleCallback(ctx: Context): Promise<void> {
    try {
      const match = (ctx as any).match;
      const action: string = match[1];
      const taskId: string = match[2];

      // Calendar action: trigger calendar event creation flow
      if (action === 'calendar') {
        await this.handleCalendarAction(ctx, taskId);
        return;
      }

      // Suggest time blocks action
      if (action === 'suggest') {
        await this.handleSuggestTimeBlocks(ctx, taskId);
        return;
      }

      // Edit mode: prompt user to reply with changes
      if (action === 'edit') {
        await ctx.reply(
          'Reply to this message with the changes you\'d like to make for this task.',
        );
        await ctx.answerCbQuery('Edit mode');
        return;
      }

      // Map action to TaskStatus
      const statusMap: Record<string, TaskStatus> = {
        done: TaskStatus.done,
        start: TaskStatus.in_progress,
        defer: TaskStatus.deferred,
      };

      const mappedStatus = statusMap[action];
      if (!mappedStatus) {
        await ctx.answerCbQuery('Unknown action');
        return;
      }

      // Look up the task to get its workspace
      const task = await this.taskService.findById(taskId);
      const updatedTask = await this.taskService.update(
        taskId,
        task.workspaceId,
        { status: mappedStatus },
      );

      // Edit original message to show updated status
      const { text, extra } = this.formatter.formatTaskBreakdown(
        {
          id: updatedTask.id,
          title: updatedTask.title,
          description: updatedTask.description,
          priority: updatedTask.priority,
          status: updatedTask.status,
        },
        (updatedTask as any).children?.map((c: any) => ({
          title: c.title,
          status: c.status,
          position: c.position,
        })) ?? [],
      );

      await ctx.editMessageText(text, extra as any);
      await ctx.answerCbQuery('Task updated!');
    } catch (error) {
      this.logger.error(`Error handling callback: ${error}`);
      await ctx.answerCbQuery('Error updating task');
    }
  }

  /**
   * Handle bot commands: /tasks, /workspace, /help, /settings.
   */
  async handleCommand(ctx: Context, command: string): Promise<void> {
    try {
      switch (command) {
        case 'tasks':
          await this.handleTasksCommand(ctx);
          break;
        case 'workspace':
          await this.handleWorkspaceCommand(ctx);
          break;
        case 'help':
          await this.handleHelpCommand(ctx);
          break;
        case 'settings':
          await this.handleSettingsCommand(ctx);
          break;
        default:
          await ctx.reply(`Unknown command: ${command}`);
      }
    } catch (error) {
      this.logger.error(`Error handling command /${command}: ${error}`);
      await ctx.reply(
        'Sorry, something went wrong processing your command. Please try again.',
      );
    }
  }

  /**
   * Handle the Calendar button: extract names/effort via LLM, resolve contacts,
   * prompt for unknown contacts, and create a Google Calendar event.
   */
  async handleCalendarAction(ctx: Context, taskId: string): Promise<void> {
    try {
      const task = await this.taskService.findById(taskId);
      const workspace = await this.prisma.workspace.findUniqueOrThrow({
        where: { id: task.workspaceId },
      });
      const chatId = String(ctx.chat!.id);

      await ctx.sendChatAction('typing');

      // Get child task titles for context
      const childTitles = ((task as any).children ?? []).map(
        (c: any) => c.title as string,
      );

      // Extract calendar info via LLM
      const extraction = await this.calendarExtraction.extract(
        task.title,
        task.description,
        childTitles,
      );

      // Resolve person names to emails
      let resolvedEmails: string[] = [];
      let unresolvedNames: string[] = [];

      if (extraction.person_names.length > 0) {
        const resolution = await this.contactService.resolveNames(
          extraction.person_names,
          workspace.id,
        );
        resolvedEmails = resolution.resolved.map((r) => r.email);
        unresolvedNames = resolution.unresolved;
      }

      // If unresolved names, start the contact prompt flow
      if (unresolvedNames.length > 0) {
        this.pendingContactResolutions.set(chatId, {
          taskId,
          resolvedEmails,
          unresolvedNames: [...unresolvedNames],
          extraction,
        });
        await ctx.reply(
          this.formatter.formatContactPrompt(unresolvedNames[0]),
          { parse_mode: 'HTML' },
        );
        await ctx.answerCbQuery('Resolving contacts...');
        return;
      }

      // All names resolved (or no names) -- create calendar event
      await this.createCalendarEventForTask(ctx, task, extraction, resolvedEmails, workspace);
      await ctx.answerCbQuery('Event created!');
    } catch (error) {
      this.logger.error(`Error handling calendar action: ${error}`);
      await ctx.answerCbQuery('Error creating calendar event');
    }
  }

  /**
   * Handle the Suggest Time button: estimate effort, query freeBusy,
   * and present time-block suggestions with accept/dismiss buttons.
   */
  async handleSuggestTimeBlocks(ctx: Context, taskId: string): Promise<void> {
    try {
      const task = await this.taskService.findById(taskId);
      const workspace = await this.prisma.workspace.findUniqueOrThrow({
        where: { id: task.workspaceId },
      });
      const chatId = String(ctx.chat!.id);

      if (!task.deadline) {
        await ctx.reply(
          'This task has no deadline set. Add a deadline first to get time-block suggestions.',
        );
        await ctx.answerCbQuery('No deadline');
        return;
      }

      await ctx.sendChatAction('typing');

      const childTitles = ((task as any).children ?? []).map(
        (c: any) => c.title as string,
      );

      // Extract effort estimate
      const extraction = await this.calendarExtraction.extract(
        task.title,
        task.description,
        childTitles,
      );

      const effortMinutes = Math.round((extraction.estimated_hours ?? 1) * 60);
      const timezone = this.config.get<string>(
        'USER_TIMEZONE',
        'America/New_York',
      );

      const suggestions = await this.timeBlockService.suggestTimeBlocks({
        calendarId:
          (workspace as any).googleCalendarId ?? 'primary',
        deadline: task.deadline,
        effortMinutes,
        timezone,
      });

      if (suggestions.length === 0) {
        await ctx.reply(
          'No available time blocks found before the deadline. Your calendar may be full.',
        );
        await ctx.answerCbQuery('No slots available');
        return;
      }

      // Store suggestions for accept handler
      this.pendingTimeBlocks.set(chatId, { taskId, suggestions });

      const { text, extra } = this.formatter.formatTimeBlockSuggestions(
        task.title,
        suggestions,
      );
      await ctx.reply(text, extra as any);
      await ctx.answerCbQuery('Finding time blocks...');
    } catch (error) {
      this.logger.error(`Error suggesting time blocks: ${error}`);
      await ctx.answerCbQuery('Error finding time blocks');
    }
  }

  /**
   * Handle time-block callback buttons (accept or dismiss).
   * Called from TelegramUpdate @Action handler.
   */
  async handleTimeBlockCallback(ctx: Context): Promise<void> {
    try {
      const match = (ctx as any).match;
      const action: string = match[1]; // 'accept' or 'dismiss'
      const data: string = match[2];   // suggestion index or 'all'

      if (action === 'accept') {
        await this.handleTimeBlockAccept(ctx, parseInt(data, 10));
      } else {
        await this.handleTimeBlockDismiss(ctx);
      }
    } catch (error) {
      this.logger.error(`Error handling time block callback: ${error}`);
      await ctx.answerCbQuery('Error processing selection');
    }
  }

  /**
   * Accept a time-block suggestion and create a calendar event.
   */
  private async handleTimeBlockAccept(
    ctx: Context,
    suggestionIndex: number,
  ): Promise<void> {
    const chatId = String(ctx.chat!.id);
    const pending = this.pendingTimeBlocks.get(chatId);

    if (!pending || !pending.suggestions[suggestionIndex]) {
      await ctx.answerCbQuery('Suggestion expired');
      return;
    }

    const suggestion = pending.suggestions[suggestionIndex];
    const timezone = this.config.get<string>(
      'USER_TIMEZONE',
      'America/New_York',
    );

    if (pending.taskId) {
      // Task-based time block acceptance
      const task = await this.taskService.findById(pending.taskId);
      const workspace = await this.prisma.workspace.findUniqueOrThrow({
        where: { id: task.workspaceId },
      });

      await this.calendarService.createEvent({
        calendarId: (workspace as any).googleCalendarId ?? 'primary',
        summary: task.title,
        description: task.description ?? undefined,
        startTime: suggestion.slot.start,
        endTime: suggestion.slot.end,
        timezone,
        taskId: pending.taskId,
      });

      this.pendingTimeBlocks.delete(chatId);

      await ctx.reply(
        this.formatter.formatCalendarEventCreated(task.title, suggestion.label),
        { parse_mode: 'HTML' },
      );
    } else {
      // Direct booking conflict resolution
      await this.calendarService.createEvent({
        calendarId: pending.calendarId ?? 'primary',
        summary: pending.summary ?? 'Event',
        startTime: suggestion.slot.start,
        endTime: suggestion.slot.end,
        timezone,
      });

      this.pendingTimeBlocks.delete(chatId);

      await ctx.reply(
        this.formatter.formatCalendarEventCreated(
          pending.summary ?? 'Event',
          suggestion.label,
        ),
        { parse_mode: 'HTML' },
      );
    }

    await ctx.answerCbQuery('Event created!');
  }

  /**
   * Dismiss time-block suggestions.
   */
  private async handleTimeBlockDismiss(ctx: Context): Promise<void> {
    const chatId = String(ctx.chat!.id);
    this.pendingTimeBlocks.delete(chatId);
    await ctx.reply('Time block suggestions dismissed.');
    await ctx.answerCbQuery('Dismissed');
  }

  /**
   * Handle a user's response to a contact email prompt.
   * Validates email, stores contact, and continues the calendar event creation flow.
   */
  private async handleContactResponse(
    ctx: Context,
    chatId: string,
    text: string,
    pending: PendingContactResolution,
  ): Promise<void> {
    const currentName = pending.unresolvedNames[0];
    const task = await this.taskService.findById(pending.taskId);
    const workspace = await this.prisma.workspace.findUniqueOrThrow({
      where: { id: task.workspaceId },
    });

    if (text.toLowerCase().trim() === 'skip') {
      // Skip this contact
      pending.unresolvedNames.shift();
    } else {
      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(text.trim())) {
        await ctx.reply(
          `That doesn't look like a valid email. Please send a valid email for <b>${this.escapeHtml(currentName)}</b>, or type 'skip'.`,
          { parse_mode: 'HTML' },
        );
        return;
      }

      // Create contact and add email to resolved list
      await this.contactService.create(currentName, text.trim(), workspace.id);
      pending.resolvedEmails.push(text.trim());
      pending.unresolvedNames.shift();
    }

    // If more unresolved names, prompt for next
    if (pending.unresolvedNames.length > 0) {
      await ctx.reply(
        this.formatter.formatContactPrompt(pending.unresolvedNames[0]),
        { parse_mode: 'HTML' },
      );
      return;
    }

    // All contacts resolved -- create the calendar event
    this.pendingContactResolutions.delete(chatId);
    await this.createCalendarEventForTask(
      ctx,
      task,
      pending.extraction,
      pending.resolvedEmails,
      workspace,
    );
  }

  /**
   * Create a Google Calendar event for a task with resolved attendees.
   */
  private async createCalendarEventForTask(
    ctx: Context,
    task: any,
    extraction: CalendarExtractionResult,
    attendeeEmails: string[],
    workspace: any,
  ): Promise<void> {
    const timezone = this.config.get<string>(
      'USER_TIMEZONE',
      'America/New_York',
    );

    // Determine start/end times, clamped to working hours (9:30 AM – 8 PM)
    // All hour comparisons use the USER's timezone, not server-local time.
    const WORK_START_HOUR = 9;
    const WORK_START_MIN = 30;
    const WORK_END_HOUR = 20;
    const WORK_END_MIN = 0;
    const workStartDecimal = WORK_START_HOUR + WORK_START_MIN / 60;
    const workEndDecimal = WORK_END_HOUR + WORK_END_MIN / 60;

    let startTime: Date;
    if (task.deadline) {
      startTime = new Date(task.deadline.getTime() - 60 * 60 * 1000); // 1 hour before deadline
    } else {
      // Default to next working hour
      startTime = new Date();
      startTime.setMinutes(0, 0, 0);
      startTime.setHours(startTime.getHours() + 1);
    }

    const effortHours = extraction.estimated_hours ?? 1;
    let endTime = new Date(
      startTime.getTime() + effortHours * 60 * 60 * 1000,
    );

    // Clamp to working hours window using the user's timezone
    const startHourDecimal = getHourDecimalInTz(startTime, timezone);
    const endHourDecimal = getHourDecimalInTz(endTime, timezone);

    if (startHourDecimal < workStartDecimal) {
      startTime = setHoursInTz(startTime, WORK_START_HOUR, WORK_START_MIN, timezone);
      endTime = new Date(startTime.getTime() + effortHours * 60 * 60 * 1000);
    }
    if (endHourDecimal > workEndDecimal) {
      endTime = setHoursInTz(endTime, WORK_END_HOUR, WORK_END_MIN, timezone);
      // If clamping end pushed it before start, shift start back
      if (endTime <= startTime) {
        startTime = new Date(endTime.getTime() - effortHours * 60 * 60 * 1000);
        if (getHourDecimalInTz(startTime, timezone) < workStartDecimal) {
          startTime = setHoursInTz(startTime, WORK_START_HOUR, WORK_START_MIN, timezone);
        }
      }
    }

    await this.calendarService.createEvent({
      calendarId: workspace.googleCalendarId ?? 'primary',
      summary: task.title,
      description: task.description ?? undefined,
      startTime,
      endTime,
      timezone,
      attendeeEmails: attendeeEmails.length > 0 ? attendeeEmails : undefined,
      taskId: task.id,
    });

    // Update estimated effort on task if extraction provided one
    if (extraction.estimated_hours !== null) {
      await this.prisma.task.update({
        where: { id: task.id },
        data: { estimatedEffort: Math.round(effortHours * 60) },
      });
    }

    const timeFormatter = new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: timezone,
    });

    await ctx.reply(
      this.formatter.formatCalendarEventCreated(
        task.title,
        timeFormatter.format(startTime),
      ),
      { parse_mode: 'HTML' },
    );
  }

  /**
   * Handle workspace selection callback from inline keyboard.
   * Resolves the workspace and creates tasks from the pending decomposition result.
   */
  async handleWorkspaceSelectCallback(ctx: Context): Promise<void> {
    try {
      const match = (ctx as any).match;
      const workspaceName: string = match[1]; // 'work' or 'personal'
      const chatId: string = match[2];

      // Check if this is a direct calendar booking workspace selection
      const pendingBooking = this.pendingDirectBookings.get(chatId);
      if (pendingBooking) {
        const resolvedWorkspace = await this.workspace.findByName(
          workspaceName as WorkspaceName,
        );
        if (!resolvedWorkspace) {
          await ctx.answerCbQuery('Workspace not found');
          return;
        }

        await ctx.answerCbQuery();
        this.pendingDirectBookings.delete(chatId);

        const emoji = workspaceName === 'work' ? '💼' : '🏠';
        await ctx.editMessageText(
          `${emoji} Scheduling in <b>${workspaceName}</b> calendar...`,
          { parse_mode: 'HTML' },
        );

        await this.createDirectCalendarEvent(
          ctx,
          chatId,
          pendingBooking.extraction,
          resolvedWorkspace,
        );
        return;
      }

      // Task workspace selection flow
      const pending = this.pendingWorkspaceSelections.get(chatId);
      if (!pending) {
        await ctx.answerCbQuery('Selection expired');
        return;
      }

      const resolvedWorkspace = await this.workspace.findByName(
        workspaceName as WorkspaceName,
      );
      if (!resolvedWorkspace) {
        await ctx.answerCbQuery('Workspace not found');
        return;
      }

      await ctx.answerCbQuery();

      await this.createTasksFromDecomposition(
        ctx,
        chatId,
        pending.text,
        pending.result,
        resolvedWorkspace,
      );

      // Only delete pending data after successful task creation
      this.pendingWorkspaceSelections.delete(chatId);

      // Edit the workspace prompt to confirm the selection
      const emoji = workspaceName === 'work' ? '💼' : '🏠';
      const taskTitle = pending.result.parent_task?.title
        ?? pending.result.sub_tasks[0]?.title
        ?? 'Task';
      await ctx.editMessageText(
        `${emoji} <b>${this.escapeHtml(taskTitle)}</b> — captured in <b>${workspaceName}</b>.`,
        { parse_mode: 'HTML' },
      );
    } catch (error) {
      this.logger.error(`Error handling workspace selection: ${error}`);
      try {
        await ctx.answerCbQuery('Error processing selection');
      } catch { /* callback may already be answered */ }
      await ctx.reply(
        'Something went wrong capturing the task. Please try sending it again.',
      );
    }
  }

  /**
   * Handle task_action intent: look up the most recently created task
   * from the session and prompt for delete confirmation.
   */
  private async handleTaskAction(
    ctx: Context,
    chatId: string,
    session: SessionState,
  ): Promise<void> {
    const taskIds = session.activeTopic?.taskIds ?? [];

    if (taskIds.length === 0) {
      await ctx.reply('No recent tasks to act on.');
      return;
    }

    // The first task ID is the parent task
    const parentTaskId = taskIds[0];

    try {
      const task = await this.taskService.findById(parentTaskId);

      const { text, extra } = this.formatter.formatDeleteConfirmation(
        task.title,
        task.id,
      );
      await ctx.reply(text, extra as any);
    } catch {
      await ctx.reply('Could not find the recent task. It may have already been deleted.');
    }
  }

  /**
   * Handle delete confirmation/cancel callback from inline keyboard.
   */
  async handleDeleteCallback(ctx: Context): Promise<void> {
    try {
      const match = (ctx as any).match;
      const action: string = match[1]; // 'confirm' or 'cancel'
      const taskId: string = match[2];

      if (action === 'cancel') {
        await ctx.editMessageText('Deletion cancelled.');
        await ctx.answerCbQuery('Cancelled');
        return;
      }

      // Confirm delete
      const task = await this.prisma.task.findUnique({
        where: { id: taskId },
        select: { workspaceId: true, title: true },
      });

      if (!task) {
        await ctx.editMessageText('Task not found.');
        await ctx.answerCbQuery('Not found');
        return;
      }

      await this.taskService.softDelete(taskId, task.workspaceId);

      await ctx.editMessageText(
        `Task <b>${this.escapeHtml(task.title)}</b> deleted.`,
        { parse_mode: 'HTML' },
      );
      await ctx.answerCbQuery('Deleted');
    } catch (error) {
      this.logger.error(`Error handling delete callback: ${error}`);
      await ctx.answerCbQuery('Error deleting task');
    }
  }

  /**
   * Process a brain dump: decompose into tasks, auto-classify workspace,
   * prompt if ambiguous, then create tasks.
   */
  private async handleBrainDump(
    ctx: Context,
    chatId: string,
    text: string,
  ): Promise<void> {
    await ctx.sendChatAction('typing');

    const result = await this.decomposition.decompose(text);

    // Resolve workspace from LLM classification
    if (result.workspace) {
      const resolvedWorkspace = await this.workspace.findByName(
        result.workspace as WorkspaceName,
      );
      if (resolvedWorkspace) {
        await this.createTasksFromDecomposition(ctx, chatId, text, result, resolvedWorkspace);
        return;
      }
    }

    // Workspace is null (ambiguous) — prompt user to choose
    this.pendingWorkspaceSelections.set(chatId, { text, result });

    const taskTitle = result.parent_task?.title
      ?? result.sub_tasks[0]?.title
      ?? 'your tasks';

    const { text: promptText, extra } = this.formatter.formatWorkspacePrompt(
      taskTitle,
      chatId,
    );
    await ctx.reply(promptText, extra as any);
  }

  /**
   * Handle direct calendar booking: extract scheduling details from raw text,
   * resolve workspace, check availability, create event. No task is created.
   */
  private async handleDirectCalendarBooking(
    ctx: Context,
    chatId: string,
    text: string,
  ): Promise<void> {
    await ctx.sendChatAction('typing');

    const timezone = this.config.get<string>('USER_TIMEZONE', 'America/New_York');
    const today = new Date().toLocaleDateString('en-CA', { timeZone: timezone });

    const extraction = await this.directCalendarExtraction.extract(text, today);

    // Store extraction and show confirmation prompt before booking
    this.pendingDirectBookings.set(chatId, { text, extraction });

    const { text: confirmText, extra } = this.formatter.formatCalendarConfirmation(
      extraction,
      chatId,
      timezone,
    );
    await ctx.reply(confirmText, extra as any);
  }

  /**
   * Handle calendar confirm/cancel callback from confirmation prompt.
   */
  async handleCalendarConfirmCallback(ctx: Context): Promise<void> {
    try {
      const match = (ctx as any).match;
      const action: string = match[1]; // 'confirm' or 'cancel'
      const chatId: string = match[2];

      if (action === 'cancel') {
        this.pendingDirectBookings.delete(chatId);
        await ctx.answerCbQuery('Cancelled');
        await ctx.editMessageText('📅 Calendar booking cancelled.');
        return;
      }

      // action === 'confirm'
      const pending = this.pendingDirectBookings.get(chatId);
      if (!pending) {
        await ctx.answerCbQuery('Booking expired');
        await ctx.editMessageText('This booking has expired. Please send your request again.');
        return;
      }

      this.pendingDirectBookings.delete(chatId);
      await ctx.answerCbQuery('Booking...');

      const { extraction } = pending;

      const targetWorkspaceName = (extraction.workspace ?? 'work') as WorkspaceName;
      const resolvedWorkspace = await this.workspace.findByName(targetWorkspaceName);
      if (resolvedWorkspace) {
        await this.createDirectCalendarEvent(ctx, chatId, extraction, resolvedWorkspace);
        return;
      }

      this.pendingDirectBookings.set(chatId, pending);
      const { text: promptText, extra } = this.formatter.formatWorkspacePromptForCalendar(
        extraction.summary,
        chatId,
      );
      await ctx.reply(promptText, extra as any);
    } catch (error) {
      this.logger.error(`Error handling calendar confirm callback: ${error}`);
      await ctx.answerCbQuery('Error').catch(() => {});
      await ctx.reply(this.formatProcessingError(error));
    }
  }

  /**
   * Create a calendar event directly from extracted scheduling details.
   * Checks availability, resolves contacts, books. Default 30 min duration.
   */
  private async createDirectCalendarEvent(
    ctx: Context,
    chatId: string,
    extraction: DirectCalendarExtractionResult,
    workspace: { id: string; name: string; googleCalendarId?: string | null },
  ): Promise<void> {
    const timezone = this.config.get<string>('USER_TIMEZONE', 'America/New_York');
    const calendarId = (workspace as any).googleCalendarId ?? 'primary';

    // Build start time from extraction (times are in the user's timezone)
    let startTime: Date;
    if (extraction.date && extraction.time) {
      // Parse the extracted date+time as local time in the user's timezone
      startTime = localTimeToUtcDate(extraction.date, extraction.time, timezone);
    } else if (extraction.date) {
      // Date but no time — default to next working hour in user's timezone
      const nowHour = getHourDecimalInTz(new Date(), timezone);
      const nextHour = Math.ceil(nowHour);
      startTime = setHoursInTz(new Date(), nextHour, 0, timezone);
    } else {
      const nowHour = getHourDecimalInTz(new Date(), timezone);
      const nextHour = Math.ceil(nowHour);
      startTime = setHoursInTz(new Date(), nextHour, 0, timezone);
    }

    const durationMinutes = extraction.duration_minutes ?? 30;
    const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000);

    // Check availability
    const calendarIdsStr = this.config.get<string>('GOOGLE_CALENDAR_IDS', '');
    const allCalendarIds = calendarIdsStr
      ? calendarIdsStr.split(',').map((id) => id.trim())
      : [calendarId];

    const busySlots = await this.calendarService.queryFreeBusy({
      calendarIds: allCalendarIds,
      startDate: startTime,
      endDate: endTime,
      timezone,
    });

    const hasConflict = busySlots.some(
      (busy) => startTime < busy.end && endTime > busy.start,
    );

    if (hasConflict) {
      // Suggest alternatives
      const searchEnd = new Date(startTime);
      searchEnd.setDate(searchEnd.getDate() + 1);

      const suggestions = await this.timeBlockService.suggestTimeBlocks({
        calendarId,
        deadline: searchEnd,
        effortMinutes: durationMinutes,
        timezone,
      });

      if (suggestions.length > 0) {
        this.pendingTimeBlocks.set(chatId, {
          taskId: '',
          suggestions,
          summary: extraction.summary,
          calendarId,
        });
        const { text, extra } = this.formatter.formatDirectBookingConflict(
          extraction.summary,
          suggestions,
        );
        await ctx.reply(text, extra as any);
      } else {
        await ctx.reply(
          'The requested time slot is busy and no alternatives were found. Try a different time.',
        );
      }
      return;
    }

    // Resolve attendee contacts if person_names provided
    let attendeeEmails: string[] = [];
    if (extraction.person_names.length > 0) {
      const resolution = await this.contactService.resolveNames(
        extraction.person_names,
        workspace.id,
      );
      attendeeEmails = resolution.resolved.map((r) => r.email);

      if (resolution.unresolved.length > 0) {
        this.logger.warn(
          `Direct booking: skipping unresolved contacts: ${resolution.unresolved.join(', ')}`,
        );
      }
    }

    await this.calendarService.createEvent({
      calendarId,
      summary: extraction.summary,
      startTime,
      endTime,
      timezone,
      attendeeEmails: attendeeEmails.length > 0 ? attendeeEmails : undefined,
    });

    const timeFormatter = new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: timezone,
    });

    const confirmText = this.formatter.formatDirectBookingConfirmation(
      extraction.summary,
      timeFormatter.format(startTime),
      timeFormatter.format(endTime),
      durationMinutes,
      attendeeEmails,
    );
    await ctx.reply(confirmText, { parse_mode: 'HTML' });
  }

  /**
   * Create tasks from a decomposition result and send the response.
   * Extracted from handleBrainDump to be reused after workspace selection.
   */
  private async createTasksFromDecomposition(
    ctx: Context,
    chatId: string,
    text: string,
    result: DecompositionResult,
    workspace: { id: string; name: string },
  ): Promise<void> {
    const createdTaskIds: string[] = [];

    if (result.needs_decomposition && result.parent_task) {
      // Create parent task
      const parentTask = await this.taskService.create({
        title: result.parent_task.title,
        description: result.parent_task.description ?? undefined,
        priority: result.parent_task.priority as TaskPriority,
        deadline: result.parent_task.deadline ?? undefined,
        workspaceId: workspace.id,
        sourceInput: text,
      });
      createdTaskIds.push(parentTask.id);

      // Create sub-tasks in order
      const createdSubTasks = [];
      for (let idx = 0; idx < result.sub_tasks.length; idx++) {
        const sub = result.sub_tasks[idx];
        const subTask = await this.taskService.create({
          title: sub.title,
          description: sub.description ?? undefined,
          priority: sub.priority as TaskPriority,
          workspaceId: workspace.id,
          parentId: parentTask.id,
          position: idx,
        });
        createdSubTasks.push(subTask);
        createdTaskIds.push(subTask.id);
      }

      // Format and send with inline keyboard
      const { text: msgText, extra } = this.formatter.formatTaskBreakdown(
        {
          id: parentTask.id,
          title: parentTask.title,
          description: parentTask.description,
          priority: parentTask.priority,
          status: parentTask.status,
        },
        createdSubTasks.map((s) => ({
          title: s.title,
          status: s.status,
          position: s.position,
        })),
      );

      const sentMsg = await ctx.reply(msgText, extra as any);

      // Store telegramMsgId on parent task for reply-to detection
      await this.prisma.task.update({
        where: { id: parentTask.id },
        data: { telegramMsgId: BigInt(sentMsg.message_id) },
      });
    } else if (result.parent_task) {
      // Single task (no decomposition needed)
      const task = await this.taskService.create({
        title: result.parent_task.title,
        description: result.parent_task.description ?? undefined,
        priority: result.parent_task.priority as TaskPriority,
        deadline: result.parent_task.deadline ?? undefined,
        workspaceId: workspace.id,
        sourceInput: text,
      });
      createdTaskIds.push(task.id);

      const { text: msgText, extra } = this.formatter.formatTaskBreakdown(
        {
          id: task.id,
          title: task.title,
          description: task.description,
          priority: task.priority,
          status: task.status,
        },
        [],
      );

      const sentMsg = await ctx.reply(msgText, extra as any);

      await this.prisma.task.update({
        where: { id: task.id },
        data: { telegramMsgId: BigInt(sentMsg.message_id) },
      });
    } else if (result.sub_tasks.length > 0) {
      // Fallback: LLM returned tasks in sub_tasks without parent_task
      const first = result.sub_tasks[0];
      const task = await this.taskService.create({
        title: first.title,
        description: first.description ?? undefined,
        priority: first.priority as TaskPriority,
        workspaceId: workspace.id,
        sourceInput: text,
      });
      createdTaskIds.push(task.id);

      const { text: msgText, extra } = this.formatter.formatTaskBreakdown(
        {
          id: task.id,
          title: task.title,
          description: task.description,
          priority: task.priority,
          status: task.status,
        },
        [],
      );

      const sentMsg = await ctx.reply(msgText, extra as any);

      await this.prisma.task.update({
        where: { id: task.id },
        data: { telegramMsgId: BigInt(sentMsg.message_id) },
      });
    }

    // Handle follow-up questions if gaps detected
    if (
      result.follow_up_needed &&
      result.detected_gaps.length > 0 &&
      createdTaskIds.length > 0
    ) {
      const summary = result.parent_task
        ? `Created task "${result.parent_task.title}" with ${result.sub_tasks.length} sub-tasks`
        : 'Created tasks from brain dump';

      const followUp = await this.followUp.generateFollowUp(
        summary,
        createdTaskIds,
        result.detected_gaps,
      );

      if (followUp.questions.length > 0) {
        // Update session topic with task IDs and pending follow-ups
        const questionTexts = followUp.questions.map((q) => q.text);
        await this.session.updateTopic(chatId, {
          id: randomUUID(),
          parentTaskId: createdTaskIds[0],
          taskIds: createdTaskIds,
          conversationHistory: [],
          pendingFollowUps: questionTexts,
        });

        // Send the first follow-up question
        await ctx.reply(
          this.formatter.formatFollowUpQuestion(followUp.questions[0].text),
          { parse_mode: 'HTML' },
        );
      }
    }

    // Add conversation turn to session
    await this.session.addConversationTurn(chatId, {
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Process a follow-up answer: enrich existing tasks with new info,
   * clear pending follow-ups, update session status.
   */
  private async handleFollowUpAnswer(
    ctx: Context,
    chatId: string,
    text: string,
    session: SessionState,
  ): Promise<void> {
    await ctx.sendChatAction('typing');

    const taskIds = session.activeTopic?.taskIds ?? [];

    // Fetch existing tasks info
    const existingTasks: ExistingTaskInfo[] = [];
    let workspaceId: string | undefined;
    for (const taskId of taskIds) {
      try {
        const task = await this.taskService.findById(taskId);
        if (!workspaceId) workspaceId = task.workspaceId;
        existingTasks.push({
          id: task.id,
          title: task.title,
          description: task.description,
          priority: task.priority,
          deadline: task.deadline?.toISOString() ?? null,
        });
      } catch {
        this.logger.warn(
          `Could not fetch task ${taskId} for enrichment`,
        );
      }
    }

    // Resolve workspace from the tasks, fall back to default
    if (!workspaceId) {
      const defaultWs = await this.workspace.getDefault();
      workspaceId = defaultWs.id;
    }

    const enrichResult = await this.enrichment.processFollowUpAnswer(
      text,
      existingTasks,
      workspaceId,
      session.activeTopic?.parentTaskId ?? undefined,
    );

    // Reply with enrichment summary
    await ctx.reply(
      `Got it! ${enrichResult.updates.summary}\n\nUpdated ${enrichResult.appliedUpdates} task(s), created ${enrichResult.newTasksCreated} new sub-task(s).`,
    );

    // Clear pending follow-ups and set session to idle
    await this.session.updateTopic(chatId, {
      id: session.activeTopic?.id ?? randomUUID(),
      parentTaskId: session.activeTopic?.parentTaskId ?? null,
      taskIds: session.activeTopic?.taskIds ?? [],
      conversationHistory:
        session.activeTopic?.conversationHistory ?? [],
      pendingFollowUps: [],
    });

    // Add conversation turn
    await this.session.addConversationTurn(chatId, {
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Handle reply-to bot messages as comments on tasks.
   * Creates comment, extracts action items, auto-creates sub-tasks if found.
   */
  private async handleComment(
    ctx: Context,
    task: any,
    commentText: string,
  ): Promise<void> {
    const message = ctx.message as Record<string, any>;

    // Create the comment
    await this.commentService.create(
      task.id,
      commentText,
      'user',
      BigInt(message.message_id),
    );

    // Extract action items from the comment
    const extraction = await this.commentProcessing.extractActionItems(
      commentText,
      task.title,
      task.description,
    );

    let response = `Comment added to task: <b>${this.escapeHtml(task.title)}</b>`;

    // Auto-create sub-tasks from action items (v1 simplicity: no confirmation)
    if (extraction.has_action_items && extraction.action_items.length > 0) {

      for (const item of extraction.action_items) {
        try {
          await this.taskService.create({
            title: item.title,
            description: item.description ?? undefined,
            priority: item.priority as TaskPriority,
            workspaceId: task.workspaceId,
            parentId: task.id,
          });
        } catch (error) {
          this.logger.warn(
            `Failed to create sub-task from action item "${item.title}": ${error}`,
          );
        }
      }

      response += `\n\nFound ${extraction.action_items.length} action item(s) and created as sub-tasks.`;
    }

    await ctx.reply(response, { parse_mode: 'HTML' });
  }

  /**
   * Handle /tasks command: list tasks with action buttons.
   */
  private async handleTasksCommand(ctx: Context): Promise<void> {
    const workspace = await this.workspace.getDefault();
    const tasks = await this.taskService.findAll(workspace.id);

    if (tasks.length === 0) {
      await ctx.reply(
        'No tasks yet. Send me a brain dump or voice message to create some!',
      );
      return;
    }

    // Send each task individually with inline keyboard (max 10)
    const displayTasks = tasks.slice(0, 10);
    for (const task of displayTasks) {
      const { text, extra } = this.formatter.formatTaskBreakdown(
        {
          id: task.id,
          title: task.title,
          description: task.description,
          priority: task.priority,
          status: task.status,
        },
        ((task as any).children ?? []).map((c: any) => ({
          title: c.title,
          status: c.status,
          position: c.position,
        })),
      );

      const sentMsg = await ctx.reply(text, extra as any);

      // Store telegramMsgId for reply-to detection
      await this.prisma.task.update({
        where: { id: task.id },
        data: { telegramMsgId: BigInt(sentMsg.message_id) },
      });
    }

    if (tasks.length > 10) {
      await ctx.reply(
        `Showing 10 of ${tasks.length} tasks. More tasks available.`,
      );
    }
  }

  /**
   * Handle /workspace command: show or switch default workspace.
   */
  private async handleWorkspaceCommand(ctx: Context): Promise<void> {
    const message = ctx.message as Record<string, any>;
    const parts = (message.text as string).split(' ');
    const arg = parts[1]?.toLowerCase();

    if (arg === 'work' || arg === 'personal') {
      const result = await this.workspace.setDefault(
        arg as WorkspaceName,
      );
      if (result) {
        await ctx.reply(
          `Default workspace switched to <b>${result.name}</b>.`,
          { parse_mode: 'HTML' },
        );
      } else {
        await ctx.reply('Failed to switch workspace. Please try again.');
      }
    } else {
      const current = await this.workspace.getDefault();
      await ctx.reply(
        `Current default workspace: <b>${current.name}</b>\n\nUsage: /workspace work or /workspace personal`,
        { parse_mode: 'HTML' },
      );
    }
  }

  /**
   * Handle /help command: show available commands and usage tips.
   */
  private async handleHelpCommand(ctx: Context): Promise<void> {
    const helpText = [
      '<b>Cortex Bot Commands</b>',
      '',
      '/tasks - View your tasks with action buttons',
      '/workspace - View or switch workspace (work/personal)',
      '/help - Show this help message',
      '/settings - View current settings',
      '',
      '<b>Usage Tips:</b>',
      '- Send a text message to brain dump tasks',
      '- Send a voice message for hands-free capture',
      '- Reply to a task message to add a comment',
      '- Tap task buttons to update status (Done/Start/Defer/Edit)',
    ].join('\n');

    await ctx.reply(helpText, { parse_mode: 'HTML' });
  }

  /**
   * Handle /settings command: show current configuration.
   */
  private async handleSettingsCommand(ctx: Context): Promise<void> {
    const workspace = await this.workspace.getDefault();
    const settingsText = [
      '<b>Current Settings</b>',
      '',
      `Default workspace: <b>${workspace.name}</b>`,
      'Session timeout: 30 minutes',
      'Voice transcription: Whisper API',
      'AI model: Claude (Anthropic)',
    ].join('\n');

    await ctx.reply(settingsText, { parse_mode: 'HTML' });
  }

  /**
   * Format a user-facing error message from a processing error.
   * Surfaces actionable info (e.g. API billing) instead of generic "something went wrong".
   */
  private formatProcessingError(error: unknown): string {
    const msg = error instanceof Error ? error.message : String(error);

    if (msg.includes('credit balance is too low') || msg.includes('billing')) {
      return '⚠️ Anthropic API credits are exhausted. Please top up at console.anthropic.com and try again.';
    }
    if (msg.includes('rate_limit') || msg.includes('overloaded')) {
      return '⏳ AI service is temporarily overloaded. Please try again in a minute.';
    }
    if (msg.includes('authentication') || msg.includes('api_key')) {
      return '⚠️ Anthropic API key issue. Please check your configuration.';
    }
    if (msg.includes('invalid_grant')) {
      return '⚠️ Google Calendar access has expired. Re-run `scripts/google-oauth-setup.ts` and update GOOGLE_REFRESH_TOKEN.';
    }
    if (msg.includes('insufficient_quota') || msg.includes('exceeded your current quota')) {
      return '⚠️ OpenAI credits are exhausted. Please top up at platform.openai.com.';
    }

    return 'Sorry, something went wrong processing your message. Please try again.';
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
