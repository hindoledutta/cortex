import { Fragment, useState } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
} from '@tanstack/react-table';
import type { SortingState, ExpandedState } from '@tanstack/react-table';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { columns, PRIORITY_CLASSES, STATUS_CLASSES } from './columns';
import { format, isPast } from 'date-fns';
import type { Task, TaskStatus } from '@/types/task';

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'captured', label: 'Captured' },
  { value: 'active', label: 'Active' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'done', label: 'Done' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'deferred', label: 'Deferred' },
];

const STATUS_ROW_BG: Record<TaskStatus, string> = {
  captured: 'bg-status-captured/15',
  active: 'bg-status-active/15',
  in_progress: 'bg-status-in-progress/15',
  done: 'bg-status-done/15',
  blocked: 'bg-status-blocked/15',
  deferred: 'bg-status-deferred/15',
};

interface TaskTableProps {
  tasks: Task[];
  onStatusChange: (taskId: string, workspaceId: string, newStatus: TaskStatus) => void;
}

export function TaskTable({ tasks, onStatusChange }: TaskTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [expanded, setExpanded] = useState<ExpandedState>({});

  const parentTasks = tasks.filter((t) => !t.parentId);

  const table = useReactTable({
    data: parentTasks,
    columns,
    state: { sorting, expanded },
    onSortingChange: setSorting,
    onExpandedChange: setExpanded,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="rounded-xl border border-border/50 overflow-hidden">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id}>
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length ? (
            table.getRowModel().rows.map((row) => (
              <Fragment key={row.id}>
                <TableRow>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
                {row.getIsExpanded() && row.original.children?.map((child) => (
                  <TableRow
                    key={child.id}
                    className={`${STATUS_ROW_BG[child.status]} animate-[row-expand_0.3s_ease-out]`}
                  >
                    <TableCell />
                    <TableCell>
                      <span className={`text-sm pl-4 ${child.status === 'done' ? 'line-through text-muted-foreground' : ''}`}>
                        {child.title}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={STATUS_CLASSES[child.status]}>
                        <select
                          value={child.status}
                          onChange={(e) => onStatusChange(child.id, child.workspaceId, e.target.value as TaskStatus)}
                          className="bg-transparent border-none outline-none cursor-pointer text-inherit text-xs appearance-none pr-3"
                          style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='currentColor'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0 center' }}
                        >
                          {STATUS_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`${PRIORITY_CLASSES[child.priority]} text-[10px]`}>
                        {child.priority}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {child.deadline ? (
                        <span className={`text-sm ${isPast(new Date(child.deadline)) ? 'text-destructive font-medium' : ''}`}>
                          {format(new Date(child.deadline), 'MMM d, yyyy')}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">--</span>
                      )}
                    </TableCell>
                    <TableCell />
                    <TableCell />
                  </TableRow>
                ))}
              </Fragment>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-24 text-center">
                No tasks found.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
