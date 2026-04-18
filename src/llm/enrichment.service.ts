import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { LlmService } from './llm.service';
import { TaskService } from '../task/task.service';
import { EnrichmentResult, EnrichmentResultSchema } from './llm.types';
import { buildEnrichmentPrompt } from './prompts/enrichment.prompt';
import { TaskPriority } from '../../prisma/generated/prisma/client/enums';

/** Input shape for existing tasks provided to enrichment */
export interface ExistingTaskInfo {
  id: string;
  title: string;
  description?: string | null;
  priority: string;
  deadline?: string | null;
}

/** Result returned after enrichment processing */
export interface EnrichmentProcessResult {
  updates: EnrichmentResult;
  appliedUpdates: number;
  newTasksCreated: number;
}

@Injectable()
export class EnrichmentService {
  private readonly logger = new Logger(EnrichmentService.name);

  constructor(
    private readonly llm: LlmService,
    private readonly taskService: TaskService,
  ) {}

  /**
   * Process a follow-up answer by extracting structured updates and applying them.
   *
   * Uses Sonnet to extract task_updates and new_sub_tasks from the user's answer,
   * then applies updates to existing tasks and creates new sub-tasks via TaskService.
   * Single task failures are logged but do not abort the entire enrichment.
   */
  async processFollowUpAnswer(
    answer: string,
    existingTasks: ExistingTaskInfo[],
    workspaceId: string,
    parentTaskId?: string,
  ): Promise<EnrichmentProcessResult> {
    const systemPrompt = buildEnrichmentPrompt();

    // Build user message with answer and existing task context
    const taskList = existingTasks
      .map(
        (t) =>
          `- ${t.id}: "${t.title}" (priority: ${t.priority}, deadline: ${t.deadline ?? 'none'})`,
      )
      .join('\n');

    const userContent = [
      `User's answer: ${answer}`,
      '',
      'Existing tasks:',
      taskList,
    ].join('\n');

    const jsonSchema = z.toJSONSchema(EnrichmentResultSchema);

    const response = await this.llm.createMessage(
      'enrichment',
      systemPrompt,
      [{ role: 'user', content: userContent }],
      jsonSchema as Record<string, unknown>,
      1024,
    );

    let enrichmentResult: EnrichmentResult;
    try {
      const parsed = JSON.parse(response.content);
      enrichmentResult = EnrichmentResultSchema.parse(parsed);
    } catch (error) {
      this.logger.error(`Enrichment response validation failed: ${error}`);
      this.logger.error(`Raw response: ${response.content}`);
      throw error;
    }

    // Apply task updates
    let appliedUpdates = 0;
    for (const taskUpdate of enrichmentResult.task_updates) {
      try {
        const dto = this.mapFieldToDto(
          taskUpdate.field,
          taskUpdate.value,
          existingTasks.find((t) => t.id === taskUpdate.task_id),
        );

        if (dto) {
          await this.taskService.update(
            taskUpdate.task_id,
            workspaceId,
            dto,
          );
          appliedUpdates++;
        }
      } catch (error) {
        this.logger.warn(
          `Failed to update task ${taskUpdate.task_id} field=${taskUpdate.field}: ${error}`,
        );
        // Continue with remaining updates -- do not abort
      }
    }

    // Create new sub-tasks
    let newTasksCreated = 0;
    for (const newTask of enrichmentResult.new_sub_tasks) {
      try {
        await this.taskService.create({
          title: newTask.title,
          description: newTask.description ?? undefined,
          priority: newTask.priority as TaskPriority,
          workspaceId,
          parentId: parentTaskId,
        });
        newTasksCreated++;
      } catch (error) {
        this.logger.warn(
          `Failed to create sub-task "${newTask.title}": ${error}`,
        );
      }
    }

    return {
      updates: enrichmentResult,
      appliedUpdates,
      newTasksCreated,
    };
  }

  /**
   * Map a field name from the LLM response to an UpdateTaskDto.
   * Returns null for unknown fields (logged as warning).
   */
  private mapFieldToDto(
    field: string,
    value: string,
    existingTask?: ExistingTaskInfo,
  ): Record<string, unknown> | null {
    switch (field) {
      case 'deadline':
        return { deadline: value };
      case 'priority':
        return { priority: value as TaskPriority };
      case 'description': {
        // Append to existing description per user decision
        const current = existingTask?.description ?? '';
        const separator = current ? '\n' : '';
        return { description: current + separator + value };
      }
      default:
        this.logger.warn(
          `Unknown field "${field}" in enrichment update, skipping`,
        );
        return null;
    }
  }
}
