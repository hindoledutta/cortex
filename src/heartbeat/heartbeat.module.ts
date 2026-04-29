import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { SettingsModule } from '../settings/settings.module';
import { HeartbeatController } from './heartbeat.controller';
import { HeartbeatService } from './heartbeat.service';
import { HeartbeatStalenessService } from './heartbeat-staleness.service';
import { SharedSecretGuard } from '../auth/shared-secret.guard';

@Module({
  imports: [ConfigModule, PrismaModule, SchedulerModule, SettingsModule],
  controllers: [HeartbeatController],
  providers: [HeartbeatService, HeartbeatStalenessService, SharedSecretGuard],
  exports: [HeartbeatService],
})
export class HeartbeatModule {}
