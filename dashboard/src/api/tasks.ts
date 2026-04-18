import { apiClient } from './client';
import type { Task } from '../types/task';

export function fetchTasks(workspaceId?: string): Promise<Task[]> {
  const params = workspaceId ? `?workspaceId=${workspaceId}` : '';
  return apiClient<Task[]>(`/api/tasks${params}`);
}

export function fetchTask(id: string, workspaceId: string): Promise<Task> {
  return apiClient<Task>(`/api/tasks/${id}?workspaceId=${workspaceId}`);
}

export function updateTask(id: string, workspaceId: string, data: Partial<Task>): Promise<Task> {
  return apiClient<Task>(`/api/tasks/${id}?workspaceId=${workspaceId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function deleteTask(id: string, workspaceId: string): Promise<Task> {
  return apiClient<Task>(`/api/tasks/${id}?workspaceId=${workspaceId}`, {
    method: 'DELETE',
  });
}
