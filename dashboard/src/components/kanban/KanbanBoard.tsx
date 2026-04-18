import { useState } from 'react';
import { DragDropProvider } from '@dnd-kit/react';
import { KanbanColumn } from './KanbanColumn';
import { TaskDetailDialog } from './TaskDetailDialog';
import type { Task, TaskStatus } from '@/types/task';

const STATUS_COLUMNS: TaskStatus[] = [
  'captured',
  'active',
  'in_progress',
  'done',
  'blocked',
  'deferred',
];

interface KanbanBoardProps {
  tasks: Task[];
  onStatusChange: (taskId: string, workspaceId: string, newStatus: TaskStatus) => void;
  onUpdate: (taskId: string, workspaceId: string, data: Partial<Task>) => void;
  onDelete: (taskId: string, workspaceId: string) => void;
}

export function KanbanBoard({ tasks, onStatusChange, onUpdate, onDelete }: KanbanBoardProps) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  // Only show parent/standalone tasks -- sub-tasks appear as indicators on parent cards
  const parentTasks = tasks.filter((t) => !t.parentId);

  // Always derive selectedTask from latest data so dialog stays fresh after mutations
  const selectedTask = selectedTaskId
    ? parentTasks.find((t) => t.id === selectedTaskId) ?? null
    : null;

  // Group tasks by status
  const columns = STATUS_COLUMNS.reduce(
    (acc, status) => {
      acc[status] = parentTasks.filter((t) => t.status === status);
      return acc;
    },
    {} as Record<TaskStatus, Task[]>,
  );

  const handleDragEnd = (event: { operation: { source: { id: string | number } | null; target: { id: string | number } | null } }) => {
    const { source, target } = event.operation;
    if (!source || !target) return;

    const taskId = String(source.id);
    const newStatus = String(target.id) as TaskStatus;

    // Find the task to get its workspaceId
    const task = parentTasks.find((t) => t.id === taskId);
    if (!task || task.status === newStatus) return;

    onStatusChange(taskId, task.workspaceId, newStatus);
  };

  const handleCardClick = (task: Task) => {
    setSelectedTaskId(task.id);
  };

  return (
    <>
      <DragDropProvider onDragEnd={handleDragEnd}>
        <div className="flex gap-4 overflow-x-auto pb-4">
          {STATUS_COLUMNS.map((status) => (
            <KanbanColumn
              key={status}
              status={status}
              tasks={columns[status]}
              onCardClick={handleCardClick}
            />
          ))}
        </div>
      </DragDropProvider>
      <TaskDetailDialog
        task={selectedTask}
        open={selectedTask !== null}
        onOpenChange={(open) => { if (!open) setSelectedTaskId(null); }}
        onStatusChange={onStatusChange}
        onUpdate={onUpdate}
        onDelete={onDelete}
      />
    </>
  );
}
