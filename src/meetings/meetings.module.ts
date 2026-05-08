import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { VaultModule } from '../vault/vault.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { MeetingsController } from './meetings.controller';
import { FathomWebhookController } from './fathom-webhook.controller';
import { MeetingsService } from './meetings.service';
import { SharedSecretGuard } from '../auth/shared-secret.guard';
import { FathomWebhookGuard } from '../auth/fathom-webhook.guard';

@Module({
  imports: [ConfigModule, PrismaModule, VaultModule, WorkspaceModule, SchedulerModule],
  controllers: [MeetingsController, FathomWebhookController],
  providers: [MeetingsService, SharedSecretGuard, FathomWebhookGuard],
  exports: [MeetingsService],
})
export class MeetingsModule {}
