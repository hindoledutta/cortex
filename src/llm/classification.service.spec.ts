import { Test, TestingModule } from '@nestjs/testing';
import { ClassificationService } from './classification.service';
import { LlmService } from './llm.service';
import { ClassificationResult } from './llm.types';

describe('ClassificationService', () => {
  let service: ClassificationService;
  let mockCreateMessage: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    mockCreateMessage = vi.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClassificationService,
        {
          provide: LlmService,
          useValue: { createMessage: mockCreateMessage },
        },
      ],
    }).compile();

    service = module.get<ClassificationService>(ClassificationService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('classifies new brain dump', async () => {
    const mockResult: ClassificationResult = {
      intent: 'new_brain_dump',
      is_continuation: false,
      confidence: 0.95,
    };

    mockCreateMessage.mockResolvedValue({
      content: JSON.stringify(mockResult),
      usage: { input_tokens: 100, output_tokens: 30 },
    });

    const result = await service.classify(
      'I need to move offices next month and set up new desks',
      [],
    );

    expect(result.intent).toBe('new_brain_dump');
    expect(result.is_continuation).toBe(false);
    expect(result.confidence).toBe(0.95);
  });

  it('classifies follow-up answer when pending questions exist', async () => {
    const mockResult: ClassificationResult = {
      intent: 'follow_up_answer',
      is_continuation: true,
      confidence: 0.9,
    };

    mockCreateMessage.mockResolvedValue({
      content: JSON.stringify(mockResult),
      usage: { input_tokens: 120, output_tokens: 30 },
    });

    await service.classify('It is due by Friday', [
      "When's this due?",
    ]);

    // Verify pending follow-ups were included in user message
    const messages = mockCreateMessage.mock.calls[0][2];
    expect(messages[0].content).toContain(
      'Pending follow-up questions:',
    );
    expect(messages[0].content).toContain("When's this due?");
  });

  it('classifies command', async () => {
    const mockResult: ClassificationResult = {
      intent: 'command',
      is_continuation: false,
      confidence: 0.99,
    };

    mockCreateMessage.mockResolvedValue({
      content: JSON.stringify(mockResult),
      usage: { input_tokens: 80, output_tokens: 30 },
    });

    const result = await service.classify('/tasks', []);

    expect(result.intent).toBe('command');
    expect(result.confidence).toBe(0.99);
  });

  it('uses Sonnet via classification operation', async () => {
    const mockResult: ClassificationResult = {
      intent: 'new_brain_dump',
      is_continuation: false,
      confidence: 0.8,
    };

    mockCreateMessage.mockResolvedValue({
      content: JSON.stringify(mockResult),
      usage: { input_tokens: 100, output_tokens: 30 },
    });

    await service.classify('some message', []);

    expect(mockCreateMessage).toHaveBeenCalledWith(
      'classification',
      expect.any(Array),
      expect.any(Array),
      expect.any(Object),
      256,
    );
  });

  it('uses prompt caching format', async () => {
    const mockResult: ClassificationResult = {
      intent: 'new_brain_dump',
      is_continuation: false,
      confidence: 0.8,
    };

    mockCreateMessage.mockResolvedValue({
      content: JSON.stringify(mockResult),
      usage: { input_tokens: 100, output_tokens: 30 },
    });

    await service.classify('some message', []);

    // System prompt should be an array with cache_control
    const systemPrompt = mockCreateMessage.mock.calls[0][1];
    expect(Array.isArray(systemPrompt)).toBe(true);
    expect(systemPrompt[0]).toHaveProperty('cache_control');
    expect(systemPrompt[0].cache_control).toEqual({
      type: 'ephemeral',
    });
  });

  it('validates response against Zod schema', async () => {
    // Invalid response: missing required fields
    const invalidResult = {
      intent: 'invalid_intent',
    };

    mockCreateMessage.mockResolvedValue({
      content: JSON.stringify(invalidResult),
      usage: { input_tokens: 100, output_tokens: 30 },
    });

    await expect(
      service.classify('some message', []),
    ).rejects.toThrow();
  });
});
