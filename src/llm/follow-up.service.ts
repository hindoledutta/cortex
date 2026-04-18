import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { LlmService } from './llm.service';
import { FollowUpResult, FollowUpResultSchema } from './llm.types';
import { buildFollowUpPrompt } from './prompts/follow-up.prompt';

@Injectable()
export class FollowUpService {
  private readonly logger = new Logger(FollowUpService.name);

  constructor(private readonly llm: LlmService) {}

  /**
   * Generate 1-2 follow-up questions for detected gaps after decomposition.
   *
   * Returns empty questions array immediately if no gaps detected (no LLM call).
   * Per user decision: only ask when gaps exist; max 1-2 questions; casual tone.
   */
  async generateFollowUp(
    decompositionSummary: string,
    taskIds: string[],
    detectedGaps: string[],
  ): Promise<FollowUpResult> {
    // No gaps = no follow-up needed. Skip LLM call entirely.
    if (detectedGaps.length === 0) {
      return { questions: [] };
    }

    const systemPrompt = buildFollowUpPrompt();

    // Build user message with decomposition context, task IDs, and gaps
    const userContent = [
      `Decomposition summary: ${decompositionSummary}`,
      `Task IDs: ${taskIds.join(', ')}`,
      `Detected gaps: ${detectedGaps.join('; ')}`,
    ].join('\n\n');

    const jsonSchema = z.toJSONSchema(FollowUpResultSchema);

    const response = await this.llm.createMessage(
      'follow-up',
      systemPrompt,
      [{ role: 'user', content: userContent }],
      jsonSchema as Record<string, unknown>,
      512,
    );

    try {
      const parsed = JSON.parse(response.content);
      const result = FollowUpResultSchema.parse(parsed);

      // Limit to max 2 questions per user decision
      if (result.questions.length > 2) {
        this.logger.warn(
          `LLM returned ${result.questions.length} questions, trimming to 2`,
        );
        return { questions: result.questions.slice(0, 2) };
      }

      return result;
    } catch (error) {
      this.logger.error(`Follow-up response validation failed: ${error}`);
      this.logger.error(`Raw response: ${response.content}`);
      throw error;
    }
  }
}
