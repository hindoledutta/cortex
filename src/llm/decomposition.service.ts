import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { LlmService } from './llm.service';
import {
  DecompositionResult,
  DecompositionResultSchema,
} from './llm.types';
import { buildDecompositionPrompt } from './prompts/decomposition.prompt';

@Injectable()
export class DecompositionService {
  private readonly logger = new Logger(DecompositionService.name);

  constructor(private readonly llm: LlmService) {}

  /**
   * Decompose a brain dump into structured tasks.
   *
   * Uses Opus 4.6 via LlmService model routing with structured JSON output.
   * Validates response with Zod as defense-in-depth after structured output.
   */
  async decompose(input: string): Promise<DecompositionResult> {
    const systemPrompt = buildDecompositionPrompt();
    const jsonSchema = z.toJSONSchema(DecompositionResultSchema);

    const response = await this.llm.createMessage(
      'decomposition',
      systemPrompt,
      [{ role: 'user', content: input }],
      jsonSchema as Record<string, unknown>,
    );

    try {
      const parsed = JSON.parse(response.content);
      // Defense-in-depth: validate with Zod even though structured output
      // should guarantee schema compliance
      return DecompositionResultSchema.parse(parsed);
    } catch (error) {
      this.logger.error(
        `Decomposition response validation failed: ${error}`,
      );
      this.logger.error(`Raw response: ${response.content}`);
      throw error;
    }
  }
}
