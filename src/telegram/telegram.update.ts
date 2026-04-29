import { UseGuards } from '@nestjs/common';
import { Update, Start, Command, On, Action, Ctx } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { ChatIdGuard } from './guards/chat-id.guard';
import { OrchestratorService } from './services/orchestrator.service';

/**
 * Telegraf update handler for the Cortex Telegram bot.
 *
 * All handlers delegate to OrchestratorService for business logic.
 * ChatIdGuard is applied at class level to restrict access to the bot owner.
 *
 * IMPORTANT: @Command decorators are placed before @On('text') to ensure
 * commands are matched before the general text handler fires.
 */
@Update()
@UseGuards(ChatIdGuard)
export class TelegramUpdate {
  constructor(private readonly orchestrator: OrchestratorService) {}

  @Start()
  async onStart(@Ctx() ctx: Context) {
    await ctx.reply(
      'Welcome to Cortex! Send me a brain dump or voice message to get started.\n\nUse /help to see all commands.',
    );
  }

  @Command('tasks')
  async onTasks(@Ctx() ctx: Context) {
    await this.orchestrator.handleCommand(ctx, 'tasks');
  }

  @Command('workspace')
  async onWorkspace(@Ctx() ctx: Context) {
    await this.orchestrator.handleCommand(ctx, 'workspace');
  }

  @Command('help')
  async onHelp(@Ctx() ctx: Context) {
    await this.orchestrator.handleCommand(ctx, 'help');
  }

  @Command('settings')
  async onSettings(@Ctx() ctx: Context) {
    await this.orchestrator.handleCommand(ctx, 'settings');
  }

  @Command('note')
  async onNote(@Ctx() ctx: Context) {
    await this.orchestrator.handleNoteCommand(ctx);
  }

  @Command('vault')
  async onVault(@Ctx() ctx: Context) {
    await this.orchestrator.handleVaultRecentCommand(ctx);
  }

  @On('text')
  async onText(@Ctx() ctx: Context) {
    await this.orchestrator.handleText(ctx);
  }

  @On('voice')
  async onVoice(@Ctx() ctx: Context) {
    await this.orchestrator.handleVoice(ctx);
  }

  @Action(/^task:(done|start|defer|edit|calendar|suggest):(.+)$/)
  async onTaskAction(@Ctx() ctx: Context) {
    await this.orchestrator.handleCallback(ctx);
  }

  @Action(/^tb:(accept|dismiss):(.+)$/)
  async onTimeBlockAction(@Ctx() ctx: Context) {
    await this.orchestrator.handleTimeBlockCallback(ctx);
  }

  @Action(/^ws:(work|personal):(.+)$/)
  async onWorkspaceSelect(@Ctx() ctx: Context) {
    await this.orchestrator.handleWorkspaceSelectCallback(ctx);
  }

  @Action(/^del:(confirm|cancel):(.+)$/)
  async onDeleteAction(@Ctx() ctx: Context) {
    await this.orchestrator.handleDeleteCallback(ctx);
  }

  @Action(/^cal:(confirm|cancel):(.+)$/)
  async onCalendarConfirmAction(@Ctx() ctx: Context) {
    await this.orchestrator.handleCalendarConfirmCallback(ctx);
  }

  @Action(/^note:undo:(.+)$/)
  async onNoteUndo(@Ctx() ctx: Context) {
    await this.orchestrator.handleNoteUndoCallback(ctx);
  }
}
