import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { LlmService } from './llm.service';

const mockCreate = vi.fn();

// Mock the Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: { create: mockCreate },
    })),
  };
});

function buildMockResponse(overrides: Record<string, unknown> = {}) {
  return {
    content: [{ type: 'text', text: '{"result": "ok"}' }],
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      ...((overrides.usage as Record<string, unknown>) ?? {}),
    },
    ...overrides,
  };
}

describe('LlmService', () => {
  let service: LlmService;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    mockCreate.mockReset();
    mockCreate.mockResolvedValue(buildMockResponse());

    const module: TestingModule = await Test.createTestingModule({
      providers: [LlmService],
    }).compile();

    service = module.get<LlmService>(LlmService);
    logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('routes decomposition to claude-opus-4-6', async () => {
    await service.createMessage('decomposition', 'system', [
      { role: 'user', content: 'test input' },
    ]);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-opus-4-6' }),
    );
  });

  it('routes classification to claude-sonnet-4-6', async () => {
    await service.createMessage('classification', 'system', [
      { role: 'user', content: 'test input' },
    ]);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-sonnet-4-6' }),
    );
  });

  it('routes follow-up to claude-sonnet-4-6', async () => {
    await service.createMessage('follow-up', 'system', [
      { role: 'user', content: 'test input' },
    ]);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-sonnet-4-6' }),
    );
  });

  it('routes enrichment to claude-sonnet-4-6', async () => {
    await service.createMessage('enrichment', 'system', [
      { role: 'user', content: 'test input' },
    ]);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-sonnet-4-6' }),
    );
  });

  it('logs token usage for every call', async () => {
    await service.createMessage('decomposition', 'system', [
      { role: 'user', content: 'test' },
    ]);

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('LLM [decomposition]'),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('input=100 output=50'),
    );
  });

  it('passes output_config when schema provided', async () => {
    const schema = {
      type: 'object',
      properties: { result: { type: 'string' } },
    };

    await service.createMessage(
      'decomposition',
      'system',
      [{ role: 'user', content: 'test' }],
      schema,
    );

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        output_config: {
          format: {
            type: 'json_schema',
            schema,
          },
        },
      }),
    );
  });

  it('omits output_config when no schema', async () => {
    await service.createMessage('decomposition', 'system', [
      { role: 'user', content: 'test' },
    ]);

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.output_config).toBeUndefined();
  });
});
