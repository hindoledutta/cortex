import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import type { Workspace } from '@/types/task';

interface WorkspaceFilterProps {
  workspaces: Workspace[];
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}

export function WorkspaceFilter({ workspaces, value, onChange }: WorkspaceFilterProps) {
  return (
    <Select
      value={value ?? '__all__'}
      onValueChange={(v) => onChange(v === '__all__' ? undefined : v)}
    >
      <SelectTrigger className="w-[180px]">
        <SelectValue placeholder="All Workspaces" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__all__">All Workspaces</SelectItem>
        {workspaces.map((ws) => (
          <SelectItem key={ws.id} value={ws.id}>
            <span className="capitalize">{ws.name}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
