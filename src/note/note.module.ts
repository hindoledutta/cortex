import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NoteService } from './note.service';

@Module({
  imports: [PrismaModule],
  providers: [NoteService],
  exports: [NoteService],
})
export class NoteModule {}
