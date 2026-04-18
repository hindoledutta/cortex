import {
  Injectable,
  Optional,
  Inject,
  forwardRef,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { parseWorkspacePrefix } from './workspace-prefix.util';
import { deriveParentStatus } from './task-status.util';
import { TaskStatus } from '../../prisma/generated/prisma/client/enums';
import { ReminderService } from '../scheduler/reminder.service';

@Injectable()
export class TaskService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(forwardRef(() => ReminderService))
    private readonly reminder?: ReminderService,
  ) {}

  /**
   * Create a new task. Parses @work/@personal prefix from title,
   * enforces sub-task depth (max 1 level), and sets completedAt if status is done.
   */
  async create(dto: CreateTaskDto) {
    const { title: parsedTitle, workspaceOverride } = parseWorkspacePrefix(
      dto.title,
    );

    let workspaceId = dto.workspaceId;

    // If prefix detected, resolve workspace by name
    if (workspaceOverride) {
      const workspace = await this.prisma.workspace.findFirst({
        where: { name: workspaceOverride },
      });
      if (workspace) {
        workspaceId = workspace.id;
      }
    }

    // Sub-task depth enforcement
    if (dto.parentId) {
      const parent = await this.prisma.task.findUnique({
        where: { id: dto.parentId },
      });
      if (!parent) {
        throw new BadRequestException('Parent task not found');
      }
      if (parent.parentId) {
        throw new BadRequestException(
          'Sub-tasks cannot have sub-tasks (max 1 level deep)',
        );
      }
    }

    const data: Record<string, unknown> = {
      title: parsedTitle,
      workspaceId,
      description: dto.description ?? null,
      sourceInput: dto.sourceInput ?? null,
      status: dto.status ?? TaskStatus.captured,
      priority: dto.priority ?? undefined,
      deadline: dto.deadline ? new Date(dto.deadline) : null,
      parentId: dto.parentId ?? null,
      position: dto.position ?? 0,
    };

    // Set completedAt if status is done
    if (data.status === TaskStatus.done) {
      data.completedAt = new Date();
    }

    const task = await this.prisma.task.create({
      data: data as any,
      include: {
        children: {
          where: { deletedAt: null },
          orderBy: { position: 'asc' },
        },
      },
    });

    // Schedule deadline reminder if task has a deadline
    if (task.deadline && this.reminder) {
      await this.reminder.scheduleReminder(
        task.id,
        task.deadline,
        task.reminderLeadMinutes,
      );
    }

    return task;
  }

  /**
   * Find all top-level tasks in a workspace, with children included.
   * Computes derived parent status for tasks that have children.
   */
  async findAll(workspaceId: string) {
    const tasks = await this.prisma.task.findMany({
      where: {
        workspaceId,
        deletedAt: null,
        parentId: null,
      },
      include: {
        children: {
          where: { deletedAt: null },
          orderBy: { position: 'asc' },
        },
        workspace: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return tasks.map((task: any) => this.attachDerivedStatus(task));
  }

  /**
   * Find all top-level tasks across all workspaces, with children and workspace included.
   * Used by the dashboard to display a unified task list.
   */
  async findAllAcrossWorkspaces() {
    const tasks = await this.prisma.task.findMany({
      where: {
        deletedAt: null,
        parentId: null,
      },
      include: {
        children: {
          where: { deletedAt: null },
          orderBy: { position: 'asc' },
        },
        workspace: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return tasks.map((task: any) => this.attachDerivedStatus(task));
  }

  /**
   * Find a single task by id within a workspace.
   * Computes derived parent status if the task has children.
   */
  async findOne(id: string, workspaceId: string) {
    const task = await this.prisma.task.findUnique({
      where: { id, workspaceId, deletedAt: null },
      include: {
        children: {
          where: { deletedAt: null },
          orderBy: { position: 'asc' },
        },
      },
    });

    if (!task) {
      throw new NotFoundException(`Task with id "${id}" not found`);
    }

    return this.attachDerivedStatus(task);
  }

  /**
   * Find a single task by id (any workspace).
   * Used by callback handlers where the task id is trusted.
   */
  async findById(id: string) {
    const task = await this.prisma.task.findUnique({
      where: { id, deletedAt: null },
      include: {
        children: {
          where: { deletedAt: null },
          orderBy: { position: 'asc' },
        },
      },
    });

    if (!task) {
      throw new NotFoundException(`Task with id "${id}" not found`);
    }

    return this.attachDerivedStatus(task);
  }

  /**
   * Update a task. Handles reparenting validation, completedAt management
   * on status transitions to/from done.
   */
  async update(id: string, workspaceId: string, dto: UpdateTaskDto) {
    const existingTask = await this.prisma.task.findUnique({
      where: { id, workspaceId, deletedAt: null },
    });

    if (!existingTask) {
      throw new NotFoundException(`Task with id "${id}" not found`);
    }

    // Validate reparenting if parentId is being changed
    if (dto.parentId !== undefined && dto.parentId !== null) {
      const newParent = await this.prisma.task.findUnique({
        where: { id: dto.parentId },
      });
      if (!newParent) {
        throw new BadRequestException('New parent task not found');
      }
      if (newParent.parentId) {
        throw new BadRequestException(
          'Cannot reparent to a sub-task (max 1 level deep)',
        );
      }
    }

    const data: Record<string, unknown> = {};

    // Copy over provided fields
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.sourceInput !== undefined) data.sourceInput = dto.sourceInput;
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.deadline !== undefined) {
      data.deadline = dto.deadline ? new Date(dto.deadline) : null;
    }
    if (dto.parentId !== undefined) data.parentId = dto.parentId;
    if (dto.position !== undefined) data.position = dto.position;
    if (dto.blockedReason !== undefined) data.blockedReason = dto.blockedReason;
    if (dto.deferredUntil !== undefined) {
      data.deferredUntil = dto.deferredUntil
        ? new Date(dto.deferredUntil)
        : null;
    }

    // Handle status transitions and completedAt management
    if (dto.status !== undefined) {
      data.status = dto.status;

      if (dto.status === TaskStatus.done) {
        // Transitioning TO done: set completedAt
        data.completedAt = new Date();
      } else if (existingTask.status === TaskStatus.done) {
        // Transitioning FROM done: clear completedAt
        data.completedAt = null;
      }
    }

    const updated = await this.prisma.task.update({
      where: { id },
      data: data as any,
      include: {
        children: {
          where: { deletedAt: null },
          orderBy: { position: 'asc' },
        },
      },
    });

    // Manage reminder on deadline/status changes
    if (this.reminder) {
      if (dto.deadline !== undefined || dto.status === TaskStatus.done || dto.status === TaskStatus.blocked) {
        if (
          updated.deadline &&
          updated.status !== TaskStatus.done &&
          updated.status !== TaskStatus.blocked &&
          updated.status !== TaskStatus.deferred
        ) {
          await this.reminder.scheduleReminder(
            updated.id,
            updated.deadline,
            updated.reminderLeadMinutes,
          );
        } else {
          await this.reminder.cancelReminder(updated.id);
        }
      }
    }

    return updated;
  }

  /**
   * Soft-delete a task and cascade to its children.
   */
  async softDelete(id: string, workspaceId: string) {
    const task = await this.prisma.task.findUnique({
      where: { id, workspaceId, deletedAt: null },
    });

    if (!task) {
      throw new NotFoundException(`Task with id "${id}" not found`);
    }

    const now = new Date();

    // Cascade soft-delete to children
    await this.prisma.task.updateMany({
      where: { parentId: id },
      data: { deletedAt: now },
    });

    // Soft-delete the task itself
    const deleted = await this.prisma.task.update({
      where: { id },
      data: { deletedAt: now },
    });

    // Cancel any pending reminder
    if (this.reminder) {
      await this.reminder.cancelReminder(id);
    }

    return deleted;
  }

  /**
   * Restore a soft-deleted task and its children.
   */
  async restore(id: string, workspaceId: string) {
    const task = await this.prisma.task.findUnique({
      where: { id, workspaceId },
    });

    if (!task) {
      throw new NotFoundException(`Task with id "${id}" not found`);
    }

    // Restore children
    await this.prisma.task.updateMany({
      where: { parentId: id },
      data: { deletedAt: null },
    });

    // Restore the task itself
    return this.prisma.task.update({
      where: { id },
      data: { deletedAt: null },
      include: {
        children: {
          where: { deletedAt: null },
          orderBy: { position: 'asc' },
        },
      },
    });
  }

  /**
   * Attach derivedStatus to a task if it has children.
   */
  private attachDerivedStatus(task: any) {
    if (task.children && task.children.length > 0) {
      const childStatuses = task.children.map(
        (c: any) => c.status as TaskStatus,
      );
      return {
        ...task,
        derivedStatus: deriveParentStatus(childStatuses),
      };
    }
    return task;
  }
}
