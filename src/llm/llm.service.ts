import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { LlmOperation, LlmResponse, MODEL_MAP } from './llm.types';

@Injectable()
export class LlmService {
  private readonly client: Anthropic;
  private readonly logger = new Logger(LlmService.name);

  constructor() {
    this.client = new Anthropic();
  }

  async createMessage(
    operation: LlmOperation,
    systemPrompt:
      | string
      | Array<{
          type: 'text';
          text: string;
          cache_control?: { type: 'ephemeral' };
        }>,
    messages: Anthropic.MessageParam[],
    outputSchema?: Record<string, unknown>,
    maxTokens = 4096,
  ): Promise<LlmResponse> {
    const model = MODEL_MAP[operation];

    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model,
      max_tokens: maxTokens,
      system: systemPrompt as Anthropic.MessageCreateParamsNonStreaming['system'],
      messages,
    };

    if (outputSchema) {
      // Strip $schema meta property -- Anthropic API doesn't accept it
      const { $schema, ...schema } = outputSchema;
      (params as unknown as Record<string, unknown>).output_config = {
        format: {
          type: 'json_schema',
          schema,
        },
      };
    }

    const response = await this.client.messages.create(params);

    // Log token usage for every call
    const usage = response.usage;
    let logMessage =
      `LLM [${operation}] model=${model} ` +
      `input=${usage.input_tokens} output=${usage.output_tokens}`;

    // Log cache tokens if available
    const cacheRead = (usage as unknown as Record<string, unknown>)
      .cache_read_input_tokens;
    if (cacheRead !== undefined) {
      logMessage += ` cache_read=${cacheRead}`;
    }

    this.logger.log(logMessage);

    // Extract text content from response
    const textBlock = response.content.find(
      (block): block is Anthropic.TextBlock => block.type === 'text',
    );

    return {
      content: textBlock?.text ?? '',
      usage: {
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
      },
    };
  }
}
