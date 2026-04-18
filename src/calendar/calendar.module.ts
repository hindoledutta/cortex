import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { GoogleAuthService } from './services/google-auth.service';
import { CalendarService } from './services/calendar.service';
import { ContactService } from './services/contact.service';
import { TimeBlockService } from './services/time-block.service';

@Module({
  imports: [ConfigModule, PrismaModule],
  providers: [GoogleAuthService, CalendarService, ContactService, TimeBlockService],
  exports: [GoogleAuthService, CalendarService, ContactService, TimeBlockService],
})
export class CalendarModule {}
