import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { LlmService } from './llm.service';
import {
  CommentExtractionResult,
  CommentExtractionResultSchema,
} from './llm.types';
import { buildCommentExtractionPrompt } from './prompts/comment-extraction.prompt';

/**
 * Extracts action items from task comments via LLM.
 *
 * Used to suggest new sub-tasks when a user comments on an existing task.
 * If has_action_items is false, the caller (orchestrator in Plan 02) skips
 * suggesting sub-tasks.
 */
@Injectable()
export class CommentProcessingService {
  private readonly logger = new Logger(CommentProcessingService.name);

  constructor(private readonly llm: LlmService) {}

  /**
   * Analyze a comment on a task and extract potential sub-tasks.
   */
  async extractActionItems(
    commentText: string,
    taskTitle: string,
    taskDescription?: string,
  ): Promise<CommentExtractionResult> {
    const systemPrompt = buildCommentExtractionPrompt();

    const userContent = [
      `Comment: ${commentText}`,
      '',
      `Task title: ${taskTitle}`,
      taskDescription ? `Task description: ${taskDescription}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const jsonSchema = z.toJSONSchema(CommentExtractionResultSchema);

    const response = await this.llm.createMessage(
      'comment-extraction',
      systemPrompt,
      [{ role: 'user', content: userContent }],
      jsonSchema as Record<string, unknown>,
      512,
    );

    try {
      const parsed = JSON.parse(response.content);
      return CommentExtractionResultSchema.parse(parsed);
    } catch (error) {
      this.logger.error(
        `Comment extraction response validation failed: ${error}`,
      );
      this.logger.error(`Raw response: ${response.content}`);
      throw error;
    }
  }
}
