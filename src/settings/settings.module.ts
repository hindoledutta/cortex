import { Module } from '@nestjs/common';
import { SettingsService } from './settings.service';

/**
 * Settings module -- provides SettingsService for user preferences.
 *
 * PrismaModule is global, so no explicit import needed.
 */
@Module({
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
