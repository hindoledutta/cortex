import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Calendar, CheckCircle2, Pencil, Trash2, Check, X } from 'lucide-react';
import { format, isPast, isBefore, addDays } from 'date-fns';
import type { Task, TaskStatus } from '@/types/task';

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'captured', label: 'Captured' },
  { value: 'active', label: 'Active' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'done', label: 'Done' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'deferred', label: 'Deferred' },
];

const STATUS_CLASSES: Record<TaskStatus, string> = {
  captured: 'bg-status-captured text-status-captured-fg border-transparent',
  active: 'bg-status-active text-status-active-fg border-transparent',
  in_progress: 'bg-status-in-progress text-status-in-progress-fg border-transparent',
  done: 'bg-status-done text-status-done-fg border-transparent',
  blocked: 'bg-status-blocked text-status-blocked-fg border-transparent',
  deferred: 'bg-status-deferred text-status-deferred-fg border-transparent',
};

const PRIORITY_CLASSES: Record<string, string> = {
  high: 'bg-priority-high text-priority-high-fg border-transparent',
  medium: 'bg-priority-medium text-priority-medium-fg border-transparent',
  low: 'bg-priority-low text-priority-low-fg border-transparent',
};

/** Merge title + description into a single string. First line = title, rest = description. */
function mergeText(title: string, description: string | null): string {
  return description ? `${title}\n${description}` : title;
}

/** Split a single string back into title + description. First line = title, rest = description. */
function splitText(text: string): { title: string; description: string | null } {
  const idx = text.indexOf('\n');
  if (idx === -1) return { title: text.trim(), description: null };
  return {
    title: text.slice(0, idx).trim(),
    description: text.slice(idx + 1).trimEnd() || null,
  };
}

interface TaskDetailDialogProps {
  task: Task | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStatusChange: (taskId: string, workspaceId: string, newStatus: TaskStatus) => void;
  onUpdate: (taskId: string, workspaceId: string, data: Partial<Task>) => void;
  onDelete: (taskId: string, workspaceId: string) => void;
}

export function TaskDetailDialog({
  task,
  open,
  onOpenChange,
  onStatusChange,
  onUpdate,
  onDelete,
}: TaskDetailDialogProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editSubtasks, setEditSubtasks] = useState<Record<string, string>>({});

  if (!task) return null;

  const doneCount = task.children?.filter((c) => c.status === 'done').length ?? 0;
  const totalChildren = task.children?.length ?? 0;
  const deadlineDate = task.deadline ? new Date(task.deadline) : null;
  const isOverdue = deadlineDate ? isPast(deadlineDate) : false;

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setIsEditing(false);
      setConfirmDelete(false);
    }
    onOpenChange(open);
  };

  const handleEditStart = () => {
    setEditTitle(task.title);
    setEditDescription(task.description ?? '');
    setEditSubtasks(
      Object.fromEntries(
        (task.children ?? []).map((c) => [c.id, mergeText(c.title, c.description)]),
      ),
    );
    setIsEditing(true);
    setConfirmDelete(false);
  };

  const handleEditSave = () => {
    const titleChanged = editTitle.trim() && editTitle.trim() !== task.title;
    const descChanged = editDescription !== (task.description ?? '');
    if (titleChanged || descChanged) {
      onUpdate(task.id, task.workspaceId, {
        title: editTitle.trim() || task.title,
        description: editDescription || null,
      });
    }

    for (const child of task.children ?? []) {
      const editText = editSubtasks[child.id];
      if (editText === undefined) continue;
      const { title, description } = splitText(editText);
      const childTitleChanged = title && title !== child.title;
      const childDescChanged = description !== (child.description ?? null);
      if (childTitleChanged || childDescChanged) {
        onUpdate(child.id, child.workspaceId, {
          title: title || child.title,
          description,
        });
      }
    }

    setIsEditing(false);
  };

  const handleDeleteClick = () => {
    if (confirmDelete) {
      onDelete(task.id, task.workspaceId);
      handleOpenChange(false);
    } else {
      setConfirmDelete(true);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          {isEditing ? (
            <Input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className="text-base font-semibold font-display pr-6"
              autoFocus
            />
          ) : (
            <DialogTitle className="pr-6 font-display">{task.title}</DialogTitle>
          )}
          <DialogDescription className="flex flex-wrap items-center gap-2 pt-1">
            <Badge variant="outline" className={STATUS_CLASSES[task.status]}>
              {task.status.replace('_', ' ')}
            </Badge>
            <Badge variant="outline" className={PRIORITY_CLASSES[task.priority]}>
              {task.priority}
            </Badge>
            {task.workspace && (
              <span className="text-xs capitalize">{task.workspace.name}</span>
            )}
            {deadlineDate && (
              <span className={`flex items-center gap-1 text-xs ${isOverdue ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
                <Calendar className="size-3" />
                {format(deadlineDate, 'MMM d, yyyy')}
              </span>
            )}
            {totalChildren > 0 && (
              <span className="text-muted-foreground flex items-center gap-1 text-xs">
                <CheckCircle2 className="size-3" />
                {doneCount}/{totalChildren} done
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {/* Description */}
        {isEditing ? (
          <textarea
            value={editDescription}
            onChange={(e) => setEditDescription(e.target.value)}
            placeholder="Add a description…"
            rows={3}
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
          />
        ) : (
          task.description && (
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{task.description}</p>
          )
        )}

        {/* Sub-tasks */}
        {totalChildren > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-semibold font-display">Sub-tasks</h4>
            <div className="divide-y rounded-xl border border-border/50 overflow-hidden">
              {task.children.map((child) => (
                <SubTaskRow
                  key={child.id}
                  task={child}
                  onStatusChange={onStatusChange}
                  onDelete={onDelete}
                  onUpdate={onUpdate}
                  editText={isEditing ? editSubtasks[child.id] : undefined}
                  onEditTextChange={(text) =>
                    setEditSubtasks((prev) => ({ ...prev, [child.id]: text }))
                  }
                />
              ))}
            </div>
          </div>
        )}

        {/* Action row */}
        <div className="flex items-center justify-between pt-2 border-t border-border/50">
          {isEditing ? (
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={handleEditSave}>
                <Check className="size-3.5 mr-1" />
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setIsEditing(false)}>
                <X className="size-3.5 mr-1" />
                Cancel
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="ghost" onClick={handleEditStart}>
              <Pencil className="size-3.5 mr-1" />
              Edit
            </Button>
          )}

          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Delete this task?</span>
              <Button size="sm" variant="destructive" onClick={handleDeleteClick}>
                Yes, delete
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={handleDeleteClick}>
              <Trash2 className="size-3.5 mr-1" />
              Delete
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SubTaskRow({
  task,
  onStatusChange,
  onDelete,
  onUpdate,
  editText,
  onEditTextChange,
}: {
  task: Task;
  onStatusChange: (taskId: string, workspaceId: string, newStatus: TaskStatus) => void;
  onDelete: (taskId: string, workspaceId: string) => void;
  onUpdate: (taskId: string, workspaceId: string, data: Partial<Task>) => void;
  editText?: string;
  onEditTextChange?: (text: string) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isEditingRow, setIsEditingRow] = useState(false);
  const [rowText, setRowText] = useState('');

  const isGlobalEditing = editText !== undefined;
  const deadlineDate = task.deadline ? new Date(task.deadline) : null;
  const isOverdue = deadlineDate ? isPast(deadlineDate) : false;
  const isDueSoon = deadlineDate
    ? !isOverdue && isBefore(deadlineDate, addDays(new Date(), 3))
    : false;

  const handleRowEditStart = () => {
    setRowText(mergeText(task.title, task.description));
    setIsEditingRow(true);
    setConfirmDelete(false);
  };

  const handleRowEditSave = () => {
    const { title, description } = splitText(rowText);
    const titleChanged = title && title !== task.title;
    const descChanged = description !== (task.description ?? null);
    if (titleChanged || descChanged) {
      onUpdate(task.id, task.workspaceId, {
        title: title || task.title,
        description,
      });
    }
    setIsEditingRow(false);
  };

  const handleDeleteConfirm = () => {
    onDelete(task.id, task.workspaceId);
    setConfirmDelete(false);
  };

  // Global edit mode — single textarea per sub-task
  if (isGlobalEditing) {
    return (
      <div className="flex items-start gap-3 px-3 py-2.5">
        <textarea
          value={editText!}
          onChange={(e) => onEditTextChange?.(e.target.value)}
          rows={2}
          className="flex-1 min-w-0 rounded-md border border-input bg-transparent px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
          placeholder="Title on first line, description below…"
        />
        <Select
          value={task.status}
          onValueChange={(value) => onStatusChange(task.id, task.workspaceId, value as TaskStatus)}
        >
          <SelectTrigger size="sm" className="w-[130px] text-xs h-7 shrink-0 mt-0.5">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  // Per-row edit mode — single textarea
  if (isEditingRow) {
    return (
      <div className="flex items-start gap-3 px-3 py-2.5">
        <textarea
          value={rowText}
          onChange={(e) => setRowText(e.target.value)}
          rows={2}
          autoFocus
          className="flex-1 min-w-0 rounded-md border border-input bg-transparent px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
          placeholder="Title on first line, description below…"
        />
        <div className="flex items-center gap-1 shrink-0 mt-0.5">
          <Button size="sm" className="h-7 px-2" onClick={handleRowEditSave}>
            <Check className="size-3" />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setIsEditingRow(false)}>
            <X className="size-3" />
          </Button>
        </div>
      </div>
    );
  }

  // Confirm delete state
  if (confirmDelete) {
    return (
      <div className="flex items-center justify-between gap-3 px-3 py-2.5 bg-destructive/5">
        <p className="text-sm line-through text-muted-foreground truncate flex-1">{task.title}</p>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-xs text-muted-foreground">Delete?</span>
          <Button size="sm" variant="destructive" className="h-7 px-2 text-xs" onClick={handleDeleteConfirm}>
            Yes
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setConfirmDelete(false)}>
            No
          </Button>
        </div>
      </div>
    );
  }

  // Normal view
  return (
    <div className="group flex items-start gap-3 px-3 py-2.5">
      <div className="flex-1 min-w-0">
        <p className={`text-sm ${task.status === 'done' ? 'line-through text-muted-foreground' : ''}`}>
          {task.title}
        </p>
        {task.description && (
          <p className="text-xs text-muted-foreground mt-0.5 whitespace-pre-wrap">
            {task.description}
          </p>
        )}
        <div className="flex items-center gap-2 mt-1">
          <Badge variant="outline" className={`${PRIORITY_CLASSES[task.priority]} text-[10px] px-1.5 py-0`}>
            {task.priority}
          </Badge>
          {deadlineDate && (
            <span
              className={`flex items-center gap-1 text-[11px] ${isOverdue ? 'text-destructive font-medium' : isDueSoon ? 'text-yellow-600' : 'text-muted-foreground'}`}
            >
              <Calendar className="size-2.5" />
              {format(deadlineDate, 'MMM d')}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0 mt-0.5">
        <button
          onClick={handleRowEditStart}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
          title="Edit sub-task"
        >
          <Pencil className="size-3" />
        </button>
        <button
          onClick={() => setConfirmDelete(true)}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-muted text-muted-foreground hover:text-destructive"
          title="Delete sub-task"
        >
          <Trash2 className="size-3" />
        </button>
        <Select
          value={task.status}
          onValueChange={(value) => onStatusChange(task.id, task.workspaceId, value as TaskStatus)}
        >
          <SelectTrigger size="sm" className="w-[130px] text-xs h-7">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
