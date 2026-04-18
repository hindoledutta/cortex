import { Test, TestingModule } from '@nestjs/testing';
import { FollowUpService } from './follow-up.service';
import { LlmService } from './llm.service';
import { FollowUpResult } from './llm.types';

describe('FollowUpService', () => {
  let service: FollowUpService;
  let mockCreateMessage: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    mockCreateMessage = vi.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FollowUpService,
        {
          provide: LlmService,
          useValue: { createMessage: mockCreateMessage },
        },
      ],
    }).compile();

    service = module.get<FollowUpService>(FollowUpService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty questions when no gaps detected', async () => {
    const result = await service.generateFollowUp(
      'Task breakdown summary',
      ['task-1', 'task-2'],
      [], // No gaps
    );

    expect(result.questions).toEqual([]);
    // Verify NO LLM call was made
    expect(mockCreateMessage).not.toHaveBeenCalled();
  });

  it('generates follow-up questions for detected gaps', async () => {
    const mockResult: FollowUpResult = {
      questions: [
        {
          text: "When's this due?",
          target_task_ids: ['task-1'],
          gap_type: 'deadline',
        },
        {
          text: 'How urgent is the equipment purchase?',
          target_task_ids: ['task-2'],
          gap_type: 'priority',
        },
      ],
    };

    mockCreateMessage.mockResolvedValue({
      content: JSON.stringify(mockResult),
      usage: { input_tokens: 300, output_tokens: 100 },
    });

    const result = await service.generateFollowUp(
      'Office move with sub-tasks',
      ['task-1', 'task-2'],
      ['missing deadline', 'unclear priority'],
    );

    expect(result.questions).toHaveLength(2);
    expect(result.questions[0].text).toBe("When's this due?");
    expect(result.questions[0].gap_type).toBe('deadline');
    expect(result.questions[1].gap_type).toBe('priority');
  });

  it('limits questions to maximum 2', async () => {
    const mockResult: FollowUpResult = {
      questions: [
        {
          text: 'Question 1',
          target_task_ids: ['task-1'],
          gap_type: 'deadline',
        },
        {
          text: 'Question 2',
          target_task_ids: ['task-2'],
          gap_type: 'priority',
        },
        {
          text: 'Question 3',
          target_task_ids: ['task-3'],
          gap_type: 'context',
        },
      ],
    };

    mockCreateMessage.mockResolvedValue({
      content: JSON.stringify(mockResult),
      usage: { input_tokens: 300, output_tokens: 150 },
    });

    const result = await service.generateFollowUp(
      'Complex project',
      ['task-1', 'task-2', 'task-3'],
      ['missing deadline', 'unclear priority', 'missing context'],
    );

    expect(result.questions).toHaveLength(2);
  });

  it('includes task IDs and gaps in user message', async () => {
    const mockResult: FollowUpResult = {
      questions: [
        {
          text: "When's this due?",
          target_task_ids: ['task-1'],
          gap_type: 'deadline',
        },
      ],
    };

    mockCreateMessage.mockResolvedValue({
      content: JSON.stringify(mockResult),
      usage: { input_tokens: 300, output_tokens: 80 },
    });

    await service.generateFollowUp(
      'Office move summary',
      ['task-1', 'task-2'],
      ['missing deadline'],
    );

    const messages = mockCreateMessage.mock.calls[0][2];
    const userContent = messages[0].content;
    expect(userContent).toContain('task-1');
    expect(userContent).toContain('task-2');
    expect(userContent).toContain('missing deadline');
  });

  it('uses Sonnet via follow-up operation', async () => {
    const mockResult: FollowUpResult = {
      questions: [
        {
          text: "When's this due?",
          target_task_ids: ['task-1'],
          gap_type: 'deadline',
        },
      ],
    };

    mockCreateMessage.mockResolvedValue({
      content: JSON.stringify(mockResult),
      usage: { input_tokens: 300, output_tokens: 80 },
    });

    await service.generateFollowUp(
      'Summary',
      ['task-1'],
      ['missing deadline'],
    );

    expect(mockCreateMessage).toHaveBeenCalledWith(
      'follow-up',
      expect.any(String),
      expect.any(Array),
      expect.any(Object),
      512,
    );
  });

  it('validates response against Zod schema', async () => {
    // Invalid: questions should have gap_type from enum
    const invalidResult = {
      questions: [
        {
          text: 'Some question',
          target_task_ids: ['task-1'],
          gap_type: 'invalid_gap_type',
        },
      ],
    };

    mockCreateMessage.mockResolvedValue({
      content: JSON.stringify(invalidResult),
      usage: { input_tokens: 300, output_tokens: 80 },
    });

    await expect(
      service.generateFollowUp('Summary', ['task-1'], ['some gap']),
    ).rejects.toThrow();
  });
});
