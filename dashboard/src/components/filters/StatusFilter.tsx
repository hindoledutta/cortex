import { Button } from '@/components/ui/button';
import type { TaskStatus } from '@/types/task';

const ALL_STATUSES: { value: TaskStatus; label: string }[] = [
  { value: 'captured', label: 'Captured' },
  { value: 'active', label: 'Active' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'done', label: 'Done' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'deferred', label: 'Deferred' },
];

const STATUS_ACTIVE_STYLES: Record<TaskStatus, string> = {
  captured: 'bg-status-captured text-status-captured-fg hover:bg-status-captured/80 border-transparent shadow-none',
  active: 'bg-status-active text-status-active-fg hover:bg-status-active/80 border-transparent shadow-none',
  in_progress: 'bg-status-in-progress text-status-in-progress-fg hover:bg-status-in-progress/80 border-transparent shadow-none',
  done: 'bg-status-done text-status-done-fg hover:bg-status-done/80 border-transparent shadow-none',
  blocked: 'bg-status-blocked text-status-blocked-fg hover:bg-status-blocked/80 border-transparent shadow-none',
  deferred: 'bg-status-deferred text-status-deferred-fg hover:bg-status-deferred/80 border-transparent shadow-none',
};

interface StatusFilterProps {
  selected: TaskStatus[];
  onChange: (statuses: TaskStatus[]) => void;
}

export function StatusFilter({ selected, onChange }: StatusFilterProps) {
  const toggle = (status: TaskStatus) => {
    if (selected.includes(status)) {
      onChange(selected.filter((s) => s !== status));
    } else {
      onChange([...selected, status]);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1">
      {ALL_STATUSES.map(({ value, label }) => (
        <Button
          key={value}
          variant={selected.includes(value) ? 'default' : 'outline'}
          size="xs"
          className={selected.includes(value) ? STATUS_ACTIVE_STYLES[value] : 'hover:bg-accent/50'}
          onClick={() => toggle(value)}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}
