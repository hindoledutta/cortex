import { Test, TestingModule } from '@nestjs/testing';
import { EnrichmentService, ExistingTaskInfo } from './enrichment.service';
import { LlmService } from './llm.service';
import { TaskService } from '../task/task.service';
import { EnrichmentResult } from './llm.types';

describe('EnrichmentService', () => {
  let service: EnrichmentService;
  let mockCreateMessage: ReturnType<typeof vi.fn>;
  let mockTaskUpdate: ReturnType<typeof vi.fn>;
  let mockTaskCreate: ReturnType<typeof vi.fn>;

  const existingTasks: ExistingTaskInfo[] = [
    {
      id: 'task-1',
      title: 'Research movers',
      description: 'Get quotes from movers',
      priority: 'medium',
      deadline: null,
    },
    {
      id: 'task-2',
      title: 'Buy equipment',
      description: null,
      priority: 'medium',
      deadline: null,
    },
  ];

  const workspaceId = 'workspace-1';

  beforeEach(async () => {
    mockCreateMessage = vi.fn();
    mockTaskUpdate = vi.fn().mockResolvedValue({});
    mockTaskCreate = vi.fn().mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EnrichmentService,
        {
          provide: LlmService,
          useValue: { createMessage: mockCreateMessage },
        },
        {
          provide: TaskService,
          useValue: {
            update: mockTaskUpdate,
            create: mockTaskCreate,
          },
        },
      ],
    }).compile();

    service = module.get<EnrichmentService>(EnrichmentService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('extracts and applies deadline update from follow-up answer', async () => {
    const mockResult: EnrichmentResult = {
      task_updates: [
        { task_id: 'task-1', field: 'deadline', value: '2026-04-01' },
      ],
      new_sub_tasks: [],
      summary: 'Updated: deadline set to April 1st',
    };

    mockCreateMessage.mockResolvedValue({
      content: JSON.stringify(mockResult),
      usage: { input_tokens: 300, output_tokens: 100 },
    });

    const result = await service.processFollowUpAnswer(
      "It's due by April 1st",
      existingTasks,
      workspaceId,
    );

    expect(mockTaskUpdate).toHaveBeenCalledWith(
      'task-1',
      workspaceId,
      { deadline: '2026-04-01' },
    );
    expect(result.appliedUpdates).toBe(1);
  });

  it('extracts and applies priority update', async () => {
    const mockResult: EnrichmentResult = {
      task_updates: [
        { task_id: 'task-2', field: 'priority', value: 'high' },
      ],
      new_sub_tasks: [],
      summary: 'Updated: equipment task marked high priority',
    };

    mockCreateMessage.mockResolvedValue({
      content: JSON.stringify(mockResult),
      usage: { input_tokens: 300, output_tokens: 100 },
    });

    const result = await service.processFollowUpAnswer(
      'The equipment is really urgent',
      existingTasks,
      workspaceId,
    );

    expect(mockTaskUpdate).toHaveBeenCalledWith(
      'task-2',
      workspaceId,
      { priority: 'high' },
    );
    expect(result.appliedUpdates).toBe(1);
  });

  it('appends description text to existing description', async () => {
    const mockResult: EnrichmentResult = {
      task_updates: [
        {
          task_id: 'task-1',
          field: 'description',
          value: 'Prefer local companies',
        },
      ],
      new_sub_tasks: [],
      summary: 'Updated: added context about local preference',
    };

    mockCreateMessage.mockResolvedValue({
      content: JSON.stringify(mockResult),
      usage: { input_tokens: 300, output_tokens: 100 },
    });

    const result = await service.processFollowUpAnswer(
      'I prefer local moving companies',
      existingTasks,
      workspaceId,
    );

    // Should append to existing description
    expect(mockTaskUpdate).toHaveBeenCalledWith(
      'task-1',
      workspaceId,
      { description: 'Get quotes from movers\nPrefer local companies' },
    );
    expect(result.appliedUpdates).toBe(1);
  });

  it('creates new sub-tasks from follow-up answer', async () => {
    const mockResult: EnrichmentResult = {
      task_updates: [],
      new_sub_tasks: [
        {
          title: 'Order bubble wrap',
          description: 'For packing fragile items',
          priority: 'low',
        },
      ],
      summary: 'Created: new sub-task for bubble wrap ordering',
    };

    mockCreateMessage.mockResolvedValue({
      content: JSON.stringify(mockResult),
      usage: { input_tokens: 300, output_tokens: 100 },
    });

    const result = await service.processFollowUpAnswer(
      'Oh we also need bubble wrap for the fragile stuff',
      existingTasks,
      workspaceId,
      'parent-1',
    );

    expect(mockTaskCreate).toHaveBeenCalledWith({
      title: 'Order bubble wrap',
      description: 'For packing fragile items',
      priority: 'low',
      workspaceId,
      parentId: 'parent-1',
    });
    expect(result.newTasksCreated).toBe(1);
  });

  it('produces change summary', async () => {
    const mockResult: EnrichmentResult = {
      task_updates: [
        { task_id: 'task-1', field: 'deadline', value: '2026-04-01' },
      ],
      new_sub_tasks: [],
      summary: 'Updated: deadline set to April 1st for research task',
    };

    mockCreateMessage.mockResolvedValue({
      content: JSON.stringify(mockResult),
      usage: { input_tokens: 300, output_tokens: 100 },
    });

    const result = await service.processFollowUpAnswer(
      "It's due April 1st",
      existingTasks,
      workspaceId,
    );

    expect(result.updates.summary).toBeTruthy();
    expect(result.updates.summary.length).toBeGreaterThan(0);
  });

  it('handles unknown field names gracefully', async () => {
    const mockResult: EnrichmentResult = {
      task_updates: [
        { task_id: 'task-1', field: 'unknownField', value: 'something' },
      ],
      new_sub_tasks: [],
      summary: 'Attempted update with unknown field',
    };

    mockCreateMessage.mockResolvedValue({
      content: JSON.stringify(mockResult),
      usage: { input_tokens: 300, output_tokens: 100 },
    });

    // Should not crash
    const result = await service.processFollowUpAnswer(
      'Some answer',
      existingTasks,
      workspaceId,
    );

    // Unknown field is skipped, taskService.update NOT called
    expect(mockTaskUpdate).not.toHaveBeenCalled();
    expect(result.appliedUpdates).toBe(0);
  });

  it('continues processing after single task update failure', async () => {
    const mockResult: EnrichmentResult = {
      task_updates: [
        { task_id: 'task-1', field: 'deadline', value: '2026-04-01' },
        { task_id: 'task-2', field: 'priority', value: 'high' },
      ],
      new_sub_tasks: [],
      summary: 'Updated deadline and priority',
    };

    mockCreateMessage.mockResolvedValue({
      content: JSON.stringify(mockResult),
      usage: { input_tokens: 300, output_tokens: 100 },
    });

    // First update throws, second succeeds
    mockTaskUpdate
      .mockRejectedValueOnce(new Error('Task not found'))
      .mockResolvedValueOnce({});

    const result = await service.processFollowUpAnswer(
      'Due April 1st and equipment is high priority',
      existingTasks,
      workspaceId,
    );

    // Should have attempted both updates
    expect(mockTaskUpdate).toHaveBeenCalledTimes(2);
    // Only second one succeeded
    expect(result.appliedUpdates).toBe(1);
  });

  it('uses Sonnet via enrichment operation', async () => {
    const mockResult: EnrichmentResult = {
      task_updates: [],
      new_sub_tasks: [],
      summary: 'No changes needed',
    };

    mockCreateMessage.mockResolvedValue({
      content: JSON.stringify(mockResult),
      usage: { input_tokens: 300, output_tokens: 50 },
    });

    await service.processFollowUpAnswer(
      'Some answer',
      existingTasks,
      workspaceId,
    );

    expect(mockCreateMessage).toHaveBeenCalledWith(
      'enrichment',
      expect.any(String),
      expect.any(Array),
      expect.any(Object),
      1024,
    );
  });

  it('validates response against Zod schema', async () => {
    // Invalid: missing summary field
    const invalidResult = {
      task_updates: [],
      new_sub_tasks: [],
      // missing summary
    };

    mockCreateMessage.mockResolvedValue({
      content: JSON.stringify(invalidResult),
      usage: { input_tokens: 300, output_tokens: 50 },
    });

    await expect(
      service.processFollowUpAnswer(
        'Some answer',
        existingTasks,
        workspaceId,
      ),
    ).rejects.toThrow();
  });
});
