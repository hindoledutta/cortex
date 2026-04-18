import { TaskStatus } from '../../prisma/generated/prisma/client/enums';

/**
 * Derive a parent task's status from its children's statuses.
 *
 * Rules (from CONTEXT.md):
 * - 100% done -> done
 * - All blocked/deferred -> blocked (or deferred if ALL are deferred)
 * - 1-99% done -> in_progress
 * - 0% done -> active (default)
 * - Empty children array -> active (standalone task fallback)
 */
export function deriveParentStatus(childStatuses: TaskStatus[]): TaskStatus {
  if (childStatuses.length === 0) {
    return TaskStatus.active;
  }

  const total = childStatuses.length;
  const doneCount = childStatuses.filter((s) => s === TaskStatus.done).length;

  // 100% done = done
  if (doneCount === total) {
    return TaskStatus.done;
  }

  // All blocked/deferred = blocked or deferred
  const allBlockedOrDeferred = childStatuses.every(
    (s) => s === TaskStatus.blocked || s === TaskStatus.deferred,
  );
  if (allBlockedOrDeferred) {
    const allDeferred = childStatuses.every(
      (s) => s === TaskStatus.deferred,
    );
    return allDeferred ? TaskStatus.deferred : TaskStatus.blocked;
  }

  // 1-99% done = in_progress
  if (doneCount > 0) {
    return TaskStatus.in_progress;
  }

  // 0% done = active (default)
  return TaskStatus.active;
}
