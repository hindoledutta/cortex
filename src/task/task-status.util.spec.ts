import { deriveParentStatus } from './task-status.util';

// Use string literals matching Prisma enum values
const TaskStatus = {
  captured: 'captured',
  active: 'active',
  in_progress: 'in_progress',
  done: 'done',
  blocked: 'blocked',
  deferred: 'deferred',
} as const;

describe('deriveParentStatus', () => {
  it('should return active for empty children array (standalone task fallback)', () => {
    expect(deriveParentStatus([])).toBe(TaskStatus.active);
  });

  it('should return done when single child is done (100%)', () => {
    expect(deriveParentStatus([TaskStatus.done])).toBe(TaskStatus.done);
  });

  it('should return done when all children are done (100%)', () => {
    expect(
      deriveParentStatus([TaskStatus.done, TaskStatus.done, TaskStatus.done]),
    ).toBe(TaskStatus.done);
  });

  it('should return active when all children are active (0% done)', () => {
    expect(deriveParentStatus([TaskStatus.active, TaskStatus.active])).toBe(
      TaskStatus.active,
    );
  });

  it('should return active when children are captured and active (0% done)', () => {
    expect(
      deriveParentStatus([TaskStatus.captured, TaskStatus.active]),
    ).toBe(TaskStatus.active);
  });

  it('should return in_progress when some children are done (50%)', () => {
    expect(
      deriveParentStatus([TaskStatus.done, TaskStatus.active]),
    ).toBe(TaskStatus.in_progress);
  });

  it('should return in_progress when done and in_progress children', () => {
    expect(
      deriveParentStatus([TaskStatus.done, TaskStatus.in_progress]),
    ).toBe(TaskStatus.in_progress);
  });

  it('should return in_progress when one done and one captured (50%)', () => {
    expect(
      deriveParentStatus([TaskStatus.done, TaskStatus.captured]),
    ).toBe(TaskStatus.in_progress);
  });

  it('should return blocked when all children are blocked', () => {
    expect(
      deriveParentStatus([TaskStatus.blocked, TaskStatus.blocked]),
    ).toBe(TaskStatus.blocked);
  });

  it('should return deferred when all children are deferred', () => {
    expect(
      deriveParentStatus([TaskStatus.deferred, TaskStatus.deferred]),
    ).toBe(TaskStatus.deferred);
  });

  it('should return blocked when children are mix of blocked and deferred', () => {
    expect(
      deriveParentStatus([TaskStatus.blocked, TaskStatus.deferred]),
    ).toBe(TaskStatus.blocked);
  });

  it('should return active when not all are blocked/deferred and 0% done', () => {
    expect(
      deriveParentStatus([TaskStatus.blocked, TaskStatus.active]),
    ).toBe(TaskStatus.active);
  });

  it('should return in_progress when done and blocked (not all blocked/deferred)', () => {
    expect(
      deriveParentStatus([TaskStatus.done, TaskStatus.blocked]),
    ).toBe(TaskStatus.in_progress);
  });

  it('should return active when single child is in_progress (0% done)', () => {
    expect(deriveParentStatus([TaskStatus.in_progress])).toBe(
      TaskStatus.active,
    );
  });

  it('should handle large mixed set correctly', () => {
    // 3 done out of 5 = 60% => in_progress
    expect(
      deriveParentStatus([
        TaskStatus.done,
        TaskStatus.done,
        TaskStatus.done,
        TaskStatus.active,
        TaskStatus.captured,
      ]),
    ).toBe(TaskStatus.in_progress);
  });

  it('should return active when all children are captured', () => {
    expect(
      deriveParentStatus([TaskStatus.captured, TaskStatus.captured]),
    ).toBe(TaskStatus.active);
  });
});
