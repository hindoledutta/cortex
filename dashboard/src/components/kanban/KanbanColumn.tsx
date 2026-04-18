import { useDroppable } from '@dnd-kit/react';
import { KanbanCard } from './KanbanCard';
import type { Task, TaskStatus } from '@/types/task';

const STATUS_LABELS: Record<TaskStatus, string> = {
  captured: 'Captured',
  active: 'Active',
  in_progress: 'In Progress',
  done: 'Done',
  blocked: 'Blocked',
  deferred: 'Deferred',
};

const STATUS_BG: Record<TaskStatus, string> = {
  captured: 'bg-status-captured/20',
  active: 'bg-status-active/20',
  in_progress: 'bg-status-in-progress/20',
  done: 'bg-status-done/20',
  blocked: 'bg-status-blocked/20',
  deferred: 'bg-status-deferred/20',
};

interface KanbanColumnProps {
  status: TaskStatus;
  tasks: Task[];
  onCardClick: (task: Task) => void;
}

export function KanbanColumn({ status, tasks, onCardClick }: KanbanColumnProps) {
  const { ref, isDropTarget } = useDroppable({ id: status });

  return (
    <div
      ref={ref}
      className={`flex min-h-[200px] w-[280px] shrink-0 flex-col rounded-2xl border border-border/50 transition-all duration-300 ${STATUS_BG[status]} ${isDropTarget ? 'scale-[1.01] shadow-lg ring-2 ring-primary/30' : ''}`}
    >
      <div className="flex items-center justify-between px-3 py-2.5">
        <h3 className="text-sm font-semibold font-display">{STATUS_LABELS[status]}</h3>
        <span className="bg-background/60 text-muted-foreground text-xs rounded-full px-2 py-0.5 font-medium">
          {tasks.length}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-2 px-2 pb-2">
        {tasks.map((task, index) => (
          <KanbanCard key={task.id} task={task} index={index} onClick={onCardClick} />
        ))}
      </div>
    </div>
  );
}
