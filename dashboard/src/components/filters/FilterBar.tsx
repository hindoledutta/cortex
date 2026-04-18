import { WorkspaceFilter } from './WorkspaceFilter';
import { StatusFilter } from './StatusFilter';
import { DeadlineFilter } from './DeadlineFilter';
import type { Workspace, TaskStatus } from '@/types/task';

interface FilterBarProps {
  workspaces: Workspace[];
  workspace: string | undefined;
  onWorkspaceChange: (value: string | undefined) => void;
  statusFilter: TaskStatus[];
  onStatusChange: (statuses: TaskStatus[]) => void;
  deadlineFilter: string | undefined;
  onDeadlineChange: (value: string | undefined) => void;
}

export function FilterBar({
  workspaces,
  workspace,
  onWorkspaceChange,
  statusFilter,
  onStatusChange,
  deadlineFilter,
  onDeadlineChange,
}: FilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <WorkspaceFilter
        workspaces={workspaces}
        value={workspace}
        onChange={onWorkspaceChange}
      />
      <StatusFilter selected={statusFilter} onChange={onStatusChange} />
      <DeadlineFilter value={deadlineFilter} onChange={onDeadlineChange} />
    </div>
  );
}
