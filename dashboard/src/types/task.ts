export type TaskStatus = 'captured' | 'active' | 'in_progress' | 'done' | 'blocked' | 'deferred';
export type TaskPriority = 'high' | 'medium' | 'low';
export type WorkspaceName = 'personal' | 'work';

export interface Workspace {
  id: string;
  name: WorkspaceName;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  workspaceId: string;
  workspace?: Workspace;
  parentId: string | null;
  title: string;
  description: string | null;
  sourceInput: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  blockedReason: string | null;
  deferredUntil: string | null;
  deadline: string | null;
  telegramMsgId: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  deletedAt: string | null;
  children: Task[];
  derivedStatus?: TaskStatus;
}
