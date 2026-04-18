import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import {
  REDIS_CLIENT,
  SESSION_TTL,
  SessionState,
  TopicContext,
  ConversationTurn,
} from './session.types';

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);
  private readonly memoryStore = new Map<string, { data: string; expiresAt: number }>();

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis | null,
  ) {
    if (!this.redis) {
      this.logger.warn('No Redis client available – using in-memory session store');
    }
  }

  private key(userId: string): string {
    return `session:${userId}`;
  }

  async get(userId: string): Promise<SessionState | null> {
    const k = this.key(userId);
    if (this.redis) {
      const data = await this.redis.get(k);
      return data ? JSON.parse(data) : null;
    }
    const entry = this.memoryStore.get(k);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.memoryStore.delete(k);
      return null;
    }
    return JSON.parse(entry.data);
  }

  async set(userId: string, state: SessionState): Promise<void> {
    state.updatedAt = new Date().toISOString();
    const k = this.key(userId);
    const json = JSON.stringify(state);
    if (this.redis) {
      await this.redis.set(k, json, 'EX', SESSION_TTL);
    } else {
      this.memoryStore.set(k, { data: json, expiresAt: Date.now() + SESSION_TTL * 1000 });
    }
  }

  async create(userId: string): Promise<SessionState> {
    const now = new Date().toISOString();
    const session: SessionState = {
      id: randomUUID(),
      userId,
      status: 'idle',
      activeTopic: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.set(userId, session);
    return session;
  }

  async getOrCreate(
    userId: string,
  ): Promise<{ session: SessionState; isNew: boolean }> {
    const existing = await this.get(userId);
    if (existing) {
      return { session: existing, isNew: false };
    }
    const session = await this.create(userId);
    return { session, isNew: true };
  }

  async refreshTtl(userId: string): Promise<void> {
    const k = this.key(userId);
    if (this.redis) {
      await this.redis.expire(k, SESSION_TTL);
    } else {
      const entry = this.memoryStore.get(k);
      if (entry) {
        entry.expiresAt = Date.now() + SESSION_TTL * 1000;
      }
    }
  }

  async clear(userId: string): Promise<void> {
    const k = this.key(userId);
    if (this.redis) {
      await this.redis.del(k);
    } else {
      this.memoryStore.delete(k);
    }
  }

  async updateTopic(userId: string, topic: TopicContext): Promise<void> {
    const session = await this.get(userId);
    if (!session) {
      this.logger.warn(`No session found for user ${userId} during updateTopic`);
      return;
    }
    session.activeTopic = topic;
    session.status =
      topic.pendingFollowUps.length > 0 ? 'awaiting_follow_up' : 'idle';
    await this.set(userId, session);
  }

  async addConversationTurn(
    userId: string,
    turn: ConversationTurn,
  ): Promise<void> {
    const session = await this.get(userId);
    if (!session) {
      this.logger.warn(
        `No session found for user ${userId} during addConversationTurn`,
      );
      return;
    }
    if (!session.activeTopic) {
      this.logger.warn(
        `No active topic for user ${userId} during addConversationTurn`,
      );
      return;
    }
    session.activeTopic.conversationHistory.push(turn);
    await this.set(userId, session);
  }
}
