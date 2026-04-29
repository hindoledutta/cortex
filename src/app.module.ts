import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { WorkspaceModule } from './workspace/workspace.module';
import { TaskModule } from './task/task.module';
import { SessionModule } from './session/session.module';
import { LlmModule } from './llm/llm.module';
import { TelegramModule } from './telegram/telegram.module';
import { CommentModule } from './comment/comment.module';
import { CalendarModule } from './calendar/calendar.module';
import { SettingsModule } from './settings/settings.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { VaultModule } from './vault/vault.module';
import { NoteModule } from './note/note.module';
import { MeetingsModule } from './meetings/meetings.module';
import { HeartbeatModule } from './heartbeat/heartbeat.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    WorkspaceModule,
    TaskModule,
    SessionModule,
    LlmModule,
    TelegramModule,
    CommentModule,
    CalendarModule,
    SettingsModule,
    SchedulerModule,
    VaultModule,
    NoteModule,
    MeetingsModule,
    HeartbeatModule,
  ],
})
export class AppModule {}
