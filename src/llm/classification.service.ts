import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { LlmService } from './llm.service';
import { ClassificationResult, ClassificationResultSchema } from './llm.types';
import { buildClassificationSystemMessage } from './prompts/classification.prompt';

@Injectable()
export class ClassificationService {
  private readonly logger = new Logger(ClassificationService.name);

  constructor(private readonly llm: LlmService) {}

  /**
   * Classify a user message into one of 4 intents using Sonnet.
   *
   * Uses prompt caching via array-format system prompt with cache_control.
   * If there are pending follow-up questions, they are included as context
   * to help the model detect follow_up_answer intent.
   */
  async classify(
    message: string,
    pendingFollowUps: string[],
  ): Promise<ClassificationResult> {
    const systemPrompt = buildClassificationSystemMessage();

    // Build user message with optional pending follow-up context
    let userContent = message;
    if (pendingFollowUps.length > 0) {
      userContent += `\n\nPending follow-up questions: ${pendingFollowUps.join('; ')}`;
    }

    const jsonSchema = z.toJSONSchema(ClassificationResultSchema);

    const response = await this.llm.createMessage(
      'classification',
      systemPrompt,
      [{ role: 'user', content: userContent }],
      jsonSchema as Record<string, unknown>,
      256, // Low maxTokens -- classification is short
    );

    try {
      const parsed = JSON.parse(response.content);
      return ClassificationResultSchema.parse(parsed);
    } catch (error) {
      this.logger.error(
        `Classification response validation failed: ${error}`,
      );
      this.logger.error(`Raw response: ${response.content}`);
      throw error;
    }
  }
}
