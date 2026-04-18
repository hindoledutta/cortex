import { Module } from '@nestjs/common';
import { CommentService } from './comment.service';

/**
 * Lightweight Comment CRUD module.
 * PrismaModule is global, so no explicit import needed.
 * Does NOT import TaskModule or LlmModule -- keep this module focused on CRUD.
 */
@Module({
  providers: [CommentService],
  exports: [CommentService],
})
export class CommentModule {}
