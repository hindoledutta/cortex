import { lazy, Suspense } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useTasks, useUpdateTask, useDeleteTask } from '@/hooks/useTasks';
import { useWorkspaces } from '@/hooks/useWorkspaces';
import { FilterBar } from '@/components/filters/FilterBar';
import { isPast, isBefore, addDays } from 'date-fns';
import type { Task, TaskStatus } from '@/types/task';

const KanbanBoard = lazy(() =>
  import('@/components/kanban/KanbanBoard').then((m) => ({ default: m.KanbanBoard })),
);

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>) => ({
    workspace: search.workspace as string | undefined,
    status: (Array.isArray(search.status) ? search.status : undefined) as TaskStatus[] | undefined,
    deadline: search.deadline as string | undefined,
  }),
  component: DashboardPage,
});

function applyDeadlineFilter(tasks: Task[], filter: string): Task[] {
  const now = new Date();
  switch (filter) {
    case 'overdue':
      return tasks.filter((t) => t.deadline && isPast(new Date(t.deadline)));
    case 'this_week':
      return tasks.filter(
        (t) => t.deadline && !isPast(new Date(t.deadline)) && isBefore(new Date(t.deadline), addDays(now, 7)),
      );
    case 'this_month':
      return tasks.filter(
        (t) => t.deadline && !isPast(new Date(t.deadline)) && isBefore(new Date(t.deadline), addDays(now, 30)),
      );
    case 'no_deadline':
      return tasks.filter((t) => !t.deadline);
    default:
      return tasks;
  }
}

function DashboardPage() {
  const { workspace, status, deadline } = Route.useSearch();
  const navigate = useNavigate({ from: '/' });

  const { data: tasks, isLoading, isError, error } = useTasks(workspace);
  const { data: workspaces } = useWorkspaces();
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();

  // Apply client-side filters
  let filteredTasks = tasks ?? [];
  if (status && status.length > 0) {
    filteredTasks = filteredTasks.filter((t) => status.includes(t.status));
  }
  if (deadline) {
    filteredTasks = applyDeadlineFilter(filteredTasks, deadline);
  }

  const handleStatusChange = (taskId: string, workspaceId: string, newStatus: TaskStatus) => {
    updateTask.mutate({ id: taskId, workspaceId, data: { status: newStatus } });
  };

  const handleUpdate = (taskId: string, workspaceId: string, data: Partial<Task>) => {
    updateTask.mutate({ id: taskId, workspaceId, data });
  };

  const handleDelete = (taskId: string, workspaceId: string) => {
    deleteTask.mutate({ id: taskId, workspaceId });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-extrabold tracking-tight font-display">Tasks</h2>
      </div>

      <FilterBar
        workspaces={workspaces ?? []}
        workspace={workspace}
        onWorkspaceChange={(value) =>
          navigate({ search: (prev) => ({ ...prev, workspace: value }) })
        }
        statusFilter={status ?? []}
        onStatusChange={(statuses) =>
          navigate({ search: (prev) => ({ ...prev, status: statuses.length > 0 ? statuses : undefined }) })
        }
        deadlineFilter={deadline}
        onDeadlineChange={(value) =>
          navigate({ search: (prev) => ({ ...prev, deadline: value }) })
        }
      />

      {isLoading && (
        <div className="flex h-40 items-center justify-center">
          <p className="text-muted-foreground">Loading tasks...</p>
        </div>
      )}

      {isError && (
        <div className="flex h-40 items-center justify-center">
          <p className="text-destructive">
            Failed to load tasks: {error?.message ?? 'Unknown error'}
          </p>
        </div>
      )}

      {!isLoading && !isError && (
        <Suspense fallback={<div className="flex h-40 items-center justify-center"><p className="text-muted-foreground">Loading board...</p></div>}>
          <KanbanBoard
            tasks={filteredTasks}
            onStatusChange={handleStatusChange}
            onUpdate={handleUpdate}
            onDelete={handleDelete}
          />
        </Suspense>
      )}
    </div>
  );
}
