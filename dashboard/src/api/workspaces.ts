import { apiClient } from './client';
import type { Workspace } from '../types/task';

export function fetchWorkspaces(): Promise<Workspace[]> {
  return apiClient<Workspace[]>('/api/workspaces');
}
