import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchTasks, updateTask, deleteTask } from '../api/tasks';
import type { Task } from '../types/task';

export function useTasks(workspaceId?: string) {
  return useQuery({
    queryKey: ['tasks', { workspaceId }],
    queryFn: () => fetchTasks(workspaceId),
  });
}

export function useUpdateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, workspaceId, data }: { id: string; workspaceId: string; data: Partial<Task> }) =>
      updateTask(id, workspaceId, data),
    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: ['tasks'] });
      const previous = queryClient.getQueriesData<Task[]>({ queryKey: ['tasks'] });
      queryClient.setQueriesData<Task[]>({ queryKey: ['tasks'] }, (old) =>
        old?.map((t) => {
          // Direct match — top-level task
          if (t.id === id) return { ...t, ...data };
          // Check children — sub-task update
          if (t.children?.some((c) => c.id === id)) {
            return {
              ...t,
              children: t.children.map((c) =>
                c.id === id ? { ...c, ...data } : c,
              ),
            };
          }
          return t;
        }),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      context?.previous?.forEach(([key, data]) => queryClient.setQueryData(key, data));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

export function useDeleteTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, workspaceId }: { id: string; workspaceId: string }) =>
      deleteTask(id, workspaceId),
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: ['tasks'] });
      const previous = queryClient.getQueriesData<Task[]>({ queryKey: ['tasks'] });
      queryClient.setQueriesData<Task[]>({ queryKey: ['tasks'] }, (old) =>
        old
          ?.filter((t) => t.id !== id)
          .map((t) =>
            t.children?.some((c) => c.id === id)
              ? { ...t, children: t.children.filter((c) => c.id !== id) }
              : t,
          ),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      context?.previous?.forEach(([key, data]) => queryClient.setQueryData(key, data));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}
