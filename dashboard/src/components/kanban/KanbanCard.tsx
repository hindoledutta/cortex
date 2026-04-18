import { useDraggable } from '@dnd-kit/react';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Calendar, CheckCircle2 } from 'lucide-react';
import { format, isPast, isBefore, addDays } from 'date-fns';
import type { Task } from '@/types/task';

const PRIORITY_CLASSES: Record<string, string> = {
  high: 'bg-priority-high text-priority-high-fg border-transparent',
  medium: 'bg-priority-medium text-priority-medium-fg border-transparent',
  low: 'bg-priority-low text-priority-low-fg border-transparent',
};

interface KanbanCardProps {
  task: Task;
  index: number;
  onClick: (task: Task) => void;
}

export function KanbanCard({ task, index, onClick }: KanbanCardProps) {
  const { ref, isDragging } = useDraggable({ id: task.id });

  const doneCount = task.children?.filter((c) => c.status === 'done').length ?? 0;
  const totalChildren = task.children?.length ?? 0;

  const deadlineDate = task.deadline ? new Date(task.deadline) : null;
  const isOverdue = deadlineDate ? isPast(deadlineDate) : false;
  const isDueSoon = deadlineDate
    ? !isOverdue && isBefore(deadlineDate, addDays(new Date(), 3))
    : false;

  return (
    <Card
      ref={ref}
      onClick={() => onClick(task)}
      className={`kanban-card-enter cursor-grab py-3 transition-all duration-200 ${isDragging ? 'dragging-card' : 'hover:-translate-y-0.5 hover:shadow-md hover:bg-card/90'}`}
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <CardHeader className="gap-1 px-3 py-0">
        <span className="text-sm font-semibold leading-tight line-clamp-2">
          {task.title}
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className={`${PRIORITY_CLASSES[task.priority]} text-[10px] px-1.5 py-0`}>
            {task.priority}
          </Badge>
          {task.workspace && (
            <span className="text-muted-foreground text-[10px] capitalize">
              {task.workspace.name}
            </span>
          )}
        </div>
      </CardHeader>
      {(deadlineDate || totalChildren > 0) && (
        <CardContent className="flex flex-wrap items-center gap-2 px-3 py-0 text-xs">
          {deadlineDate && (
            <span
              className={`flex items-center gap-1 ${isOverdue ? 'text-destructive font-medium' : isDueSoon ? 'text-yellow-600' : 'text-muted-foreground'}`}
            >
              <Calendar className="size-3" />
              {format(deadlineDate, 'MMM d')}
            </span>
          )}
          {totalChildren > 0 && (
            <span className="text-muted-foreground flex items-center gap-1">
              <CheckCircle2 className="size-3" />
              {doneCount}/{totalChildren}
            </span>
          )}
        </CardContent>
      )}
    </Card>
  );
}
