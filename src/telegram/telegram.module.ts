import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TelegrafModule } from 'nestjs-telegraf';
import { PrismaModule } from '../prisma/prisma.module';
import { LlmModule } from '../llm/llm.module';
import { SessionModule } from '../session/session.module';
import { TaskModule } from '../task/task.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { CommentModule } from '../comment/comment.module';
import { CalendarModule } from '../calendar/calendar.module';
import { VaultModule } from '../vault/vault.module';
import { NoteModule } from '../note/note.module';
import { ChatIdGuard } from './guards/chat-id.guard';
import { VoiceService } from './services/voice.service';
import { MessageFormatterService } from './services/message-formatter.service';
import { OrchestratorService } from './services/orchestrator.service';
import { TelegramUpdate } from './telegram.update';

/**
 * Telegram interface module -- fully wired for end-to-end bot operation.
 *
 * Configures TelegrafModule with webhook-based bot via ConfigService.
 * Imports all dependent modules (LLM, Session, Task, Workspace, Comment)
 * and registers the OrchestratorService and TelegramUpdate handler.
 */
@Module({
  imports: [
    TelegrafModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => {
        const token = config.get<string>('TELEGRAM_BOT_TOKEN')!;
        return {
          token,
          launchOptions: {
            webhook: {
              domain: config.get<string>('WEBHOOK_DOMAIN')!,
              hookPath: `/bot/${token}`,
            },
          },
        };
      },
      inject: [ConfigService],
    }),
    ConfigModule,
    PrismaModule,
    LlmModule,
    SessionModule,
    forwardRef(() => TaskModule),
    WorkspaceModule,
    CommentModule,
    CalendarModule,
    VaultModule,
    NoteModule,
  ],
  providers: [
    ChatIdGuard,
    VoiceService,
    MessageFormatterService,
    OrchestratorService,
    TelegramUpdate,
  ],
  exports: [TelegrafModule, VoiceService, MessageFormatterService],
})
export class TelegramModule {}
