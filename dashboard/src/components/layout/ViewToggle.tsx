import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LayoutGrid, List } from 'lucide-react';

interface ViewToggleProps {
  view: 'kanban' | 'list';
  onViewChange: (view: 'kanban' | 'list') => void;
}

export function ViewToggle({ view, onViewChange }: ViewToggleProps) {
  return (
    <Tabs value={view} onValueChange={(v) => onViewChange(v as 'kanban' | 'list')}>
      <TabsList>
        <TabsTrigger value="kanban">
          <LayoutGrid className="mr-2 h-4 w-4" />
          Kanban
        </TabsTrigger>
        <TabsTrigger value="list">
          <List className="mr-2 h-4 w-4" />
          List
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
