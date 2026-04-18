/** 30 minutes in seconds -- session inactivity TTL per requirements */
export const SESSION_TTL = 1800;

/** Redis injection token for NestJS DI */
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

export type SessionStatus = 'idle' | 'awaiting_follow_up';

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string; // ISO 8601
}

export interface TopicContext {
  id: string; // UUID for this topic
  parentTaskId: string | null;
  taskIds: string[]; // All task IDs created/modified in this topic
  conversationHistory: ConversationTurn[];
  pendingFollowUps: string[]; // Question texts awaiting answers
}

export interface SessionState {
  id: string;
  userId: string;
  status: SessionStatus;
  activeTopic: TopicContext | null;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}
