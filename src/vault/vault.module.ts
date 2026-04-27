import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { VaultService } from './vault.service';

@Module({
  imports: [ConfigModule, PrismaModule],
  providers: [VaultService],
  exports: [VaultService],
})
export class VaultModule {}
