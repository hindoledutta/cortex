/**
 * Callback data prefix for inline keyboard buttons.
 * Used to namespace callback queries by entity type.
 */
export const CALLBACK_PREFIX = {
  TASK: 'task',
  CALENDAR: 'cal',
  TIMEBLOCK: 'tb',
  CONTACT: 'contact',
  WORKSPACE: 'ws',
  DELETE: 'del',
} as const;

/**
 * Action types for task inline keyboard buttons.
 */
export const TASK_ACTIONS = {
  DONE: 'done',
  START: 'start',
  DEFER: 'defer',
  EDIT: 'edit',
  CALENDAR: 'calendar',
  SUGGEST: 'suggest',
} as const;

/**
 * Action types for workspace selection inline keyboard buttons.
 */
export const WORKSPACE_ACTIONS = {
  WORK: 'work',
  PERSONAL: 'personal',
} as const;

/**
 * Action types for delete confirmation inline keyboard buttons.
 */
export const DELETE_ACTIONS = {
  CONFIRM: 'confirm',
  CANCEL: 'cancel',
} as const;

/**
 * Action types for calendar-related inline keyboard buttons.
 */
export const CALENDAR_ACTIONS = {
  ACCEPT: 'accept',
  DISMISS: 'dismiss',
  CONFIRM: 'confirm',
  CANCEL: 'cancel',
} as const;

/**
 * Maximum message length for Telegram (4096 limit, leave margin).
 */
export const MAX_MESSAGE_LENGTH = 4000;

/**
 * Format callback data string for inline keyboard buttons.
 * Pattern: prefix:action:entityId
 */
export function formatCallbackData(
  prefix: string,
  action: string,
  entityId: string,
): string {
  return `${prefix}:${action}:${entityId}`;
}

/**
 * Parse callback data string from inline keyboard button press.
 */
export function parseCallbackData(data: string): {
  prefix: string;
  action: string;
  entityId: string;
} {
  const [prefix, action, entityId] = data.split(':');
  return { prefix, action, entityId };
}
