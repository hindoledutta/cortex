import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CommentSource } from '../../prisma/generated/prisma/client/enums';

@Injectable()
export class CommentService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a comment linked to a task.
   */
  async create(
    taskId: string,
    content: string,
    source: CommentSource = 'user',
    telegramMsgId?: bigint,
  ) {
    return this.prisma.comment.create({
      data: {
        taskId,
        content,
        source,
        telegramMsgId: telegramMsgId ?? null,
      },
    });
  }

  /**
   * Retrieve all comments for a task, ordered by creation time ascending.
   */
  async findByTaskId(taskId: string) {
    return this.prisma.comment.findMany({
      where: { taskId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Look up a task by its telegramMsgId field.
   * Used for reply-to detection: maps a replied-to bot message
   * back to the task it represents.
   */
  async findTaskByTelegramMsgId(telegramMsgId: bigint) {
    return this.prisma.task.findFirst({
      where: { telegramMsgId },
    });
  }
}
