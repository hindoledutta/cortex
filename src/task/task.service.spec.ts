import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TaskService } from './task.service';
import { PrismaService } from '../prisma/prisma.service';

describe('TaskService', () => {
  let service: TaskService;

  const mockPrisma = {
    task: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    workspace: {
      findFirst: vi.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TaskService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<TaskService>(TaskService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('create', () => {
    it('should create a task with correct workspace and default status captured', async () => {
      const dto = { title: 'Test task', workspaceId: 'ws-1' };
      const createdTask = {
        id: 'task-1',
        title: 'Test task',
        workspaceId: 'ws-1',
        status: 'captured',
        priority: 'medium',
        parentId: null,
        children: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockPrisma.task.create.mockResolvedValue(createdTask);

      const result = await service.create(dto);

      expect(mockPrisma.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: 'Test task',
            workspaceId: 'ws-1',
          }),
          include: expect.objectContaining({
            children: expect.any(Object),
          }),
        }),
      );
      expect(result).toEqual(createdTask);
    });

    it('should parse @work prefix and resolve workspace', async () => {
      const dto = { title: '@work Buy office supplies', workspaceId: 'ws-personal' };
      const workWorkspace = { id: 'ws-work', name: 'work' };
      const createdTask = {
        id: 'task-1',
        title: 'Buy office supplies',
        workspaceId: 'ws-work',
        status: 'captured',
        children: [],
      };

      mockPrisma.workspace.findFirst.mockResolvedValue(workWorkspace);
      mockPrisma.task.create.mockResolvedValue(createdTask);

      const result = await service.create(dto);

      expect(mockPrisma.workspace.findFirst).toHaveBeenCalledWith({
        where: { name: 'work' },
      });
      expect(mockPrisma.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: 'Buy office supplies',
            workspaceId: 'ws-work',
          }),
        }),
      );
      expect(result.title).toBe('Buy office supplies');
    });

    it('should create sub-task when parentId provided', async () => {
      const dto = {
        title: 'Sub task',
        workspaceId: 'ws-1',
        parentId: 'parent-1',
      };
      const parentTask = {
        id: 'parent-1',
        parentId: null,
        workspaceId: 'ws-1',
        deletedAt: null,
      };
      const createdTask = {
        id: 'task-2',
        title: 'Sub task',
        workspaceId: 'ws-1',
        parentId: 'parent-1',
        children: [],
      };

      mockPrisma.task.findUnique.mockResolvedValue(parentTask);
      mockPrisma.task.create.mockResolvedValue(createdTask);

      const result = await service.create(dto);

      expect(result.parentId).toBe('parent-1');
    });

    it('should reject sub-task of sub-task (depth enforcement)', async () => {
      const dto = {
        title: 'Nested sub task',
        workspaceId: 'ws-1',
        parentId: 'child-1',
      };
      const childTask = {
        id: 'child-1',
        parentId: 'parent-1', // already has a parent
        workspaceId: 'ws-1',
        deletedAt: null,
      };

      mockPrisma.task.findUnique.mockResolvedValue(childTask);

      await expect(service.create(dto)).rejects.toThrow(BadRequestException);
    });

    it('should set completedAt when status is done', async () => {
      const dto = {
        title: 'Already done task',
        workspaceId: 'ws-1',
        status: 'done' as any,
      };
      const createdTask = {
        id: 'task-1',
        title: 'Already done task',
        workspaceId: 'ws-1',
        status: 'done',
        completedAt: new Date(),
        children: [],
      };

      mockPrisma.task.create.mockResolvedValue(createdTask);

      await service.create(dto);

      expect(mockPrisma.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'done',
            completedAt: expect.any(Date),
          }),
        }),
      );
    });
  });

  describe('findAll', () => {
    it('should return only tasks in specified workspace with deletedAt null', async () => {
      const tasks = [
        {
          id: 'task-1',
          workspaceId: 'ws-1',
          parentId: null,
          status: 'active',
          children: [],
          deletedAt: null,
        },
      ];
      mockPrisma.task.findMany.mockResolvedValue(tasks);

      const result = await service.findAll('ws-1');

      expect(mockPrisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            workspaceId: 'ws-1',
            deletedAt: null,
            parentId: null,
          },
        }),
      );
      expect(result).toHaveLength(1);
    });

    it('should include children ordered by position', async () => {
      mockPrisma.task.findMany.mockResolvedValue([]);

      await service.findAll('ws-1');

      expect(mockPrisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            children: expect.objectContaining({
              where: { deletedAt: null },
              orderBy: { position: 'asc' },
            }),
          }),
        }),
      );
    });

    it('should compute derived parent status for tasks with children', async () => {
      const tasks = [
        {
          id: 'parent-1',
          workspaceId: 'ws-1',
          parentId: null,
          status: 'active',
          children: [
            { id: 'child-1', status: 'done' },
            { id: 'child-2', status: 'active' },
          ],
          deletedAt: null,
        },
      ];
      mockPrisma.task.findMany.mockResolvedValue(tasks);

      const result = await service.findAll('ws-1');

      // 1 done, 1 active = 50% => in_progress
      expect(result[0].derivedStatus).toBe('in_progress');
    });
  });

  describe('findOne', () => {
    it('should return task by id and workspace', async () => {
      const task = {
        id: 'task-1',
        workspaceId: 'ws-1',
        status: 'active',
        children: [],
        deletedAt: null,
      };
      mockPrisma.task.findUnique.mockResolvedValue(task);

      const result = await service.findOne('task-1', 'ws-1');

      expect(mockPrisma.task.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'task-1', workspaceId: 'ws-1', deletedAt: null },
        }),
      );
      expect(result.id).toBe('task-1');
    });

    it('should throw NotFoundException when not found', async () => {
      mockPrisma.task.findUnique.mockResolvedValue(null);

      await expect(service.findOne('not-exist', 'ws-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should compute derived status when task has children', async () => {
      const task = {
        id: 'parent-1',
        workspaceId: 'ws-1',
        status: 'active',
        children: [
          { id: 'child-1', status: 'done' },
          { id: 'child-2', status: 'done' },
        ],
        deletedAt: null,
      };
      mockPrisma.task.findUnique.mockResolvedValue(task);

      const result = await service.findOne('parent-1', 'ws-1');

      // All done => derived status is done
      expect(result.derivedStatus).toBe('done');
    });
  });

  describe('update', () => {
    it('should update task fields', async () => {
      const existingTask = {
        id: 'task-1',
        workspaceId: 'ws-1',
        status: 'active',
        parentId: null,
        deletedAt: null,
      };
      const updatedTask = {
        ...existingTask,
        title: 'Updated title',
        children: [],
      };

      mockPrisma.task.findUnique.mockResolvedValue(existingTask);
      mockPrisma.task.update.mockResolvedValue(updatedTask);

      const result = await service.update('task-1', 'ws-1', {
        title: 'Updated title',
      });

      expect(mockPrisma.task.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'task-1' },
          data: expect.objectContaining({ title: 'Updated title' }),
        }),
      );
      expect(result.title).toBe('Updated title');
    });

    it('should validate new parentId for reparenting', async () => {
      const existingTask = {
        id: 'task-1',
        workspaceId: 'ws-1',
        status: 'active',
        parentId: 'old-parent',
        deletedAt: null,
      };
      const newParent = {
        id: 'new-parent',
        parentId: 'grandparent', // has parent => reject
        workspaceId: 'ws-1',
        deletedAt: null,
      };

      mockPrisma.task.findUnique
        .mockResolvedValueOnce(existingTask) // find the task
        .mockResolvedValueOnce(newParent); // find the new parent

      await expect(
        service.update('task-1', 'ws-1', { parentId: 'new-parent' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should set completedAt when transitioning to done', async () => {
      const existingTask = {
        id: 'task-1',
        workspaceId: 'ws-1',
        status: 'active',
        parentId: null,
        completedAt: null,
        deletedAt: null,
      };
      const updatedTask = {
        ...existingTask,
        status: 'done',
        completedAt: new Date(),
        children: [],
      };

      mockPrisma.task.findUnique.mockResolvedValue(existingTask);
      mockPrisma.task.update.mockResolvedValue(updatedTask);

      await service.update('task-1', 'ws-1', { status: 'done' as any });

      expect(mockPrisma.task.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'done',
            completedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('should clear completedAt when transitioning from done', async () => {
      const existingTask = {
        id: 'task-1',
        workspaceId: 'ws-1',
        status: 'done',
        parentId: null,
        completedAt: new Date(),
        deletedAt: null,
      };
      const updatedTask = {
        ...existingTask,
        status: 'active',
        completedAt: null,
        children: [],
      };

      mockPrisma.task.findUnique.mockResolvedValue(existingTask);
      mockPrisma.task.update.mockResolvedValue(updatedTask);

      await service.update('task-1', 'ws-1', { status: 'active' as any });

      expect(mockPrisma.task.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'active',
            completedAt: null,
          }),
        }),
      );
    });

    it('should throw NotFoundException when task not found', async () => {
      mockPrisma.task.findUnique.mockResolvedValue(null);

      await expect(
        service.update('not-exist', 'ws-1', { title: 'Updated' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('softDelete', () => {
    it('should set deletedAt on task and children', async () => {
      const task = {
        id: 'task-1',
        workspaceId: 'ws-1',
        deletedAt: null,
        children: [{ id: 'child-1' }],
      };
      const deletedTask = { ...task, deletedAt: new Date() };

      mockPrisma.task.findUnique.mockResolvedValue(task);
      mockPrisma.task.update.mockResolvedValue(deletedTask);
      mockPrisma.task.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.softDelete('task-1', 'ws-1');

      // Should update children
      expect(mockPrisma.task.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { parentId: 'task-1' },
          data: { deletedAt: expect.any(Date) },
        }),
      );

      // Should update the task itself
      expect(mockPrisma.task.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'task-1' },
          data: { deletedAt: expect.any(Date) },
        }),
      );
    });

    it('should throw NotFoundException when task not found', async () => {
      mockPrisma.task.findUnique.mockResolvedValue(null);

      await expect(service.softDelete('not-exist', 'ws-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('restore', () => {
    it('should clear deletedAt on task and children', async () => {
      const task = {
        id: 'task-1',
        workspaceId: 'ws-1',
        deletedAt: new Date(),
      };
      const restoredTask = { ...task, deletedAt: null, children: [] };

      mockPrisma.task.findUnique.mockResolvedValue(task);
      mockPrisma.task.update.mockResolvedValue(restoredTask);
      mockPrisma.task.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.restore('task-1', 'ws-1');

      // Should restore children
      expect(mockPrisma.task.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { parentId: 'task-1' },
          data: { deletedAt: null },
        }),
      );

      // Should restore the task itself
      expect(mockPrisma.task.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'task-1' },
          data: { deletedAt: null },
        }),
      );

      expect(result.deletedAt).toBeNull();
    });

    it('should throw NotFoundException when task not found', async () => {
      mockPrisma.task.findUnique.mockResolvedValue(null);

      await expect(service.restore('not-exist', 'ws-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
