import { Test, TestingModule } from '@nestjs/testing';
import { DecompositionService } from './decomposition.service';
import { LlmService } from './llm.service';
import { DecompositionResult } from './llm.types';

describe('DecompositionService', () => {
  let service: DecompositionService;
  let mockCreateMessage: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    mockCreateMessage = vi.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DecompositionService,
        {
          provide: LlmService,
          useValue: { createMessage: mockCreateMessage },
        },
      ],
    }).compile();

    service = module.get<DecompositionService>(DecompositionService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('decomposes complex brain dump into parent + sub-tasks', async () => {
    const mockResult: DecompositionResult = {
      needs_decomposition: true,
      parent_task: {
        title: 'Office move planning',
        description: 'Plan and execute office relocation',
        priority: 'high',
        deadline: '2026-04-01',
      },
      sub_tasks: [
        {
          title: 'Research moving companies',
          description: 'Get quotes from 3 movers',
          priority: 'high',
          position: 1,
        },
        {
          title: 'Pack electronics',
          description: null,
          priority: 'medium',
          position: 2,
        },
        {
          title: 'Update address with vendors',
          description: null,
          priority: 'low',
          position: 3,
        },
      ],
      follow_up_needed: false,
      detected_gaps: [],
    };

    mockCreateMessage.mockResolvedValue({
      content: JSON.stringify(mockResult),
      usage: { input_tokens: 500, output_tokens: 200 },
    });

    const result = await service.decompose(
      'We need to move offices by April. Get quotes, pack stuff, update vendors.',
      'Work',
    );

    expect(result.needs_decomposition).toBe(true);
    expect(result.parent_task).not.toBeNull();
    expect(result.parent_task!.title).toBe('Office move planning');
    expect(result.sub_tasks).toHaveLength(3);
    expect(result.sub_tasks[0].title).toBe('Research moving companies');
    expect(result.sub_tasks[1].position).toBe(2);
  });

  it('returns single task for simple input', async () => {
    const mockResult: DecompositionResult = {
      needs_decomposition: false,
      parent_task: null,
      sub_tasks: [
        {
          title: 'Buy milk',
          description: null,
          priority: 'low',
          position: 1,
        },
      ],
      follow_up_needed: false,
      detected_gaps: [],
    };

    mockCreateMessage.mockResolvedValue({
      content: JSON.stringify(mockResult),
      usage: { input_tokens: 200, output_tokens: 80 },
    });

    const result = await service.decompose('Buy milk', 'Personal');

    expect(result.needs_decomposition).toBe(false);
    expect(result.parent_task).toBeNull();
    expect(result.sub_tasks).toHaveLength(1);
    expect(result.sub_tasks[0].title).toBe('Buy milk');
  });

  it('detects gaps and sets follow_up_needed', async () => {
    const mockResult: DecompositionResult = {
      needs_decomposition: true,
      parent_task: {
        title: 'Project launch',
        description: 'Launch the new product',
        priority: 'high',
        deadline: null,
      },
      sub_tasks: [
        {
          title: 'Write launch email',
          description: null,
          priority: 'medium',
          position: 1,
        },
      ],
      follow_up_needed: true,
      detected_gaps: ['missing deadline'],
    };

    mockCreateMessage.mockResolvedValue({
      content: JSON.stringify(mockResult),
      usage: { input_tokens: 300, output_tokens: 150 },
    });

    const result = await service.decompose(
      'Launch the new product, send emails, etc',
      'Work',
    );

    expect(result.follow_up_needed).toBe(true);
    expect(result.detected_gaps).toContain('missing deadline');
  });

  it('validates LLM response against Zod schema', async () => {
    // Malformed response: missing required fields
    const malformedResult = {
      needs_decomposition: true,
      // missing parent_task, sub_tasks, follow_up_needed, detected_gaps
    };

    mockCreateMessage.mockResolvedValue({
      content: JSON.stringify(malformedResult),
      usage: { input_tokens: 200, output_tokens: 50 },
    });

    await expect(
      service.decompose('some input', 'Work'),
    ).rejects.toThrow();
  });

  it('passes decomposition system prompt and workspace context', async () => {
    const mockResult: DecompositionResult = {
      needs_decomposition: false,
      parent_task: null,
      sub_tasks: [
        { title: 'Task', description: null, priority: 'medium', position: 1 },
      ],
      follow_up_needed: false,
      detected_gaps: [],
    };

    mockCreateMessage.mockResolvedValue({
      content: JSON.stringify(mockResult),
      usage: { input_tokens: 200, output_tokens: 80 },
    });

    await service.decompose('do something', 'My Workspace');

    expect(mockCreateMessage).toHaveBeenCalledWith(
      'decomposition',
      expect.stringContaining('My Workspace'),
      expect.any(Array),
      expect.any(Object),
    );
  });

  it('passes user brain dump as user message', async () => {
    const mockResult: DecompositionResult = {
      needs_decomposition: false,
      parent_task: null,
      sub_tasks: [
        { title: 'Task', description: null, priority: 'medium', position: 1 },
      ],
      follow_up_needed: false,
      detected_gaps: [],
    };

    mockCreateMessage.mockResolvedValue({
      content: JSON.stringify(mockResult),
      usage: { input_tokens: 200, output_tokens: 80 },
    });

    await service.decompose('my brain dump text', 'Work');

    const messages = mockCreateMessage.mock.calls[0][2];
    expect(messages).toEqual([
      { role: 'user', content: 'my brain dump text' },
    ]);
  });
});
