import type { ColumnDef } from '@tanstack/react-table';
import { Badge } from '@/components/ui/badge';
import { format, isPast } from 'date-fns';
import { ArrowUpDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Task, TaskStatus } from '@/types/task';

export const STATUS_CLASSES: Record<TaskStatus, string> = {
  captured: 'bg-status-captured text-status-captured-fg border-transparent',
  active: 'bg-status-active text-status-active-fg border-transparent',
  in_progress: 'bg-status-in-progress text-status-in-progress-fg border-transparent',
  done: 'bg-status-done text-status-done-fg border-transparent',
  blocked: 'bg-status-blocked text-status-blocked-fg border-transparent',
  deferred: 'bg-status-deferred text-status-deferred-fg border-transparent',
};

export const PRIORITY_CLASSES: Record<string, string> = {
  high: 'bg-priority-high text-priority-high-fg border-transparent',
  medium: 'bg-priority-medium text-priority-medium-fg border-transparent',
  low: 'bg-priority-low text-priority-low-fg border-transparent',
};

function SortableHeader({ column, label }: { column: { toggleSorting: (desc?: boolean) => void; getIsSorted: () => false | 'asc' | 'desc' }; label: string }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-3 h-8"
      onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
    >
      {label}
      <ArrowUpDown className="ml-1 size-3.5" />
    </Button>
  );
}

export const columns: ColumnDef<Task>[] = [
  {
    id: 'expand',
    header: () => null,
    cell: ({ row }) => {
      const hasChildren = (row.original.children?.length ?? 0) > 0;
      if (!hasChildren) return <span className="w-6 inline-block" />;
      return (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={(e) => {
            e.stopPropagation();
            row.toggleExpanded();
          }}
        >
          <ChevronRight
            className={`size-4 transition-transform ${row.getIsExpanded() ? 'rotate-90' : ''}`}
          />
        </Button>
      );
    },
    size: 36,
  },
  {
    accessorKey: 'title',
    header: ({ column }) => <SortableHeader column={column} label="Title" />,
    cell: ({ row }) => (
      <span className="font-medium">{row.getValue('title')}</span>
    ),
  },
  {
    accessorKey: 'status',
    header: ({ column }) => <SortableHeader column={column} label="Status" />,
    cell: ({ row }) => {
      const status = row.getValue('status') as TaskStatus;
      return (
        <Badge variant="outline" className={STATUS_CLASSES[status]}>
          {status.replace('_', ' ')}
        </Badge>
      );
    },
  },
  {
    accessorKey: 'priority',
    header: ({ column }) => <SortableHeader column={column} label="Priority" />,
    cell: ({ row }) => {
      const priority = row.getValue('priority') as 'high' | 'medium' | 'low';
      return <Badge variant="outline" className={PRIORITY_CLASSES[priority]}>{priority}</Badge>;
    },
  },
  {
    accessorKey: 'deadline',
    header: ({ column }) => <SortableHeader column={column} label="Deadline" />,
    cell: ({ row }) => {
      const deadline = row.getValue('deadline') as string | null;
      if (!deadline) return <span className="text-muted-foreground">--</span>;
      const date = new Date(deadline);
      const overdue = isPast(date);
      return (
        <span className={overdue ? 'text-destructive font-medium' : ''}>
          {format(date, 'MMM d, yyyy')}
        </span>
      );
    },
  },
  {
    id: 'workspace',
    accessorFn: (row) => row.workspace?.name ?? 'Unknown',
    header: ({ column }) => <SortableHeader column={column} label="Workspace" />,
    cell: ({ row }) => (
      <span className="capitalize">{row.getValue('workspace')}</span>
    ),
  },
  {
    id: 'subtasks',
    accessorFn: (row) => row.children?.length ?? 0,
    header: ({ column }) => <SortableHeader column={column} label="Sub-tasks" />,
    cell: ({ row }) => {
      const count = row.getValue('subtasks') as number;
      if (count === 0) return <span className="text-muted-foreground">--</span>;
      const done = row.original.children?.filter((c) => c.status === 'done').length ?? 0;
      return (
        <span className="text-sm">
          {done}/{count}
        </span>
      );
    },
  },
];
