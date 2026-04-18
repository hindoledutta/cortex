import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';

interface DeadlineFilterProps {
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}

export function DeadlineFilter({ value, onChange }: DeadlineFilterProps) {
  return (
    <Select
      value={value ?? '__all__'}
      onValueChange={(v) => onChange(v === '__all__' ? undefined : v)}
    >
      <SelectTrigger className="w-[160px]">
        <SelectValue placeholder="All deadlines" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__all__">All deadlines</SelectItem>
        <SelectItem value="overdue">Overdue</SelectItem>
        <SelectItem value="this_week">Due this week</SelectItem>
        <SelectItem value="this_month">Due this month</SelectItem>
        <SelectItem value="no_deadline">No deadline</SelectItem>
      </SelectContent>
    </Select>
  );
}
