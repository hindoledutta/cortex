import { Test, TestingModule } from '@nestjs/testing';
import { SessionService } from './session.service';
import {
  REDIS_CLIENT,
  SESSION_TTL,
  SessionState,
  TopicContext,
} from './session.types';

describe('SessionService', () => {
  let service: SessionService;

  const mockRedis = {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    expire: vi.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionService,
        { provide: REDIS_CLIENT, useValue: mockRedis },
      ],
    }).compile();

    service = module.get<SessionService>(SessionService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeSession(overrides: Partial<SessionState> = {}): SessionState {
    return {
      id: 'session-1',
      userId: 'user-1',
      status: 'idle',
      activeTopic: null,
      createdAt: '2026-02-28T00:00:00.000Z',
      updatedAt: '2026-02-28T00:00:00.000Z',
      ...overrides,
    };
  }

  function makeTopic(overrides: Partial<TopicContext> = {}): TopicContext {
    return {
      id: 'topic-1',
      parentTaskId: null,
      taskIds: [],
      conversationHistory: [],
      pendingFollowUps: [],
      ...overrides,
    };
  }

  describe('create', () => {
    it('creates a new session with idle status', async () => {
      mockRedis.set.mockResolvedValue('OK');

      const session = await service.create('user-1');

      expect(session.status).toBe('idle');
      expect(session.activeTopic).toBeNull();
      expect(session.userId).toBe('user-1');
      expect(session.id).toBeDefined();
      expect(session.createdAt).toBeDefined();

      expect(mockRedis.set).toHaveBeenCalledWith(
        'session:user-1',
        expect.any(String),
        'EX',
        1800,
      );
    });
  });

  describe('get', () => {
    it('returns null when no session exists', async () => {
      mockRedis.get.mockResolvedValue(null);

      const result = await service.get('user-1');

      expect(result).toBeNull();
      expect(mockRedis.get).toHaveBeenCalledWith('session:user-1');
    });

    it('returns parsed session when exists', async () => {
      const session = makeSession();
      mockRedis.get.mockResolvedValue(JSON.stringify(session));

      const result = await service.get('user-1');

      expect(result).toEqual(session);
      expect(result!.id).toBe('session-1');
      expect(result!.status).toBe('idle');
    });
  });

  describe('getOrCreate', () => {
    it('returns existing session with isNew=false', async () => {
      const session = makeSession();
      mockRedis.get.mockResolvedValue(JSON.stringify(session));

      const result = await service.getOrCreate('user-1');

      expect(result.isNew).toBe(false);
      expect(result.session).toEqual(session);
      expect(mockRedis.set).not.toHaveBeenCalled();
    });

    it('creates new session when expired with isNew=true', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockRedis.set.mockResolvedValue('OK');

      const result = await service.getOrCreate('user-1');

      expect(result.isNew).toBe(true);
      expect(result.session.status).toBe('idle');
      expect(result.session.userId).toBe('user-1');
      expect(mockRedis.set).toHaveBeenCalled();
    });
  });

  describe('refreshTtl', () => {
    it('calls expire with SESSION_TTL', async () => {
      mockRedis.expire.mockResolvedValue(1);

      await service.refreshTtl('user-1');

      expect(mockRedis.expire).toHaveBeenCalledWith(
        'session:user-1',
        SESSION_TTL,
      );
      expect(mockRedis.expire).toHaveBeenCalledWith(
        'session:user-1',
        1800,
      );
    });
  });

  describe('clear', () => {
    it('deletes session from Redis', async () => {
      mockRedis.del.mockResolvedValue(1);

      await service.clear('user-1');

      expect(mockRedis.del).toHaveBeenCalledWith('session:user-1');
    });
  });

  describe('set', () => {
    it('uses single SET EX command (not separate SET + EXPIRE)', async () => {
      mockRedis.set.mockResolvedValue('OK');
      const session = makeSession();

      await service.set('user-1', session);

      // Verify SET called with exactly key, value, 'EX', TTL
      expect(mockRedis.set).toHaveBeenCalledTimes(1);
      const args = mockRedis.set.mock.calls[0];
      expect(args).toHaveLength(4);
      expect(args[0]).toBe('session:user-1');
      expect(typeof args[1]).toBe('string');
      expect(args[2]).toBe('EX');
      expect(args[3]).toBe(1800);

      // Verify EXPIRE was NOT called separately
      expect(mockRedis.expire).not.toHaveBeenCalled();
    });
  });

  describe('updateTopic', () => {
    it('sets status to awaiting_follow_up when pendingFollowUps present', async () => {
      const session = makeSession();
      mockRedis.get.mockResolvedValue(JSON.stringify(session));
      mockRedis.set.mockResolvedValue('OK');

      const topic = makeTopic({
        pendingFollowUps: ['What is the deadline?'],
      });

      await service.updateTopic('user-1', topic);

      const savedState = JSON.parse(mockRedis.set.mock.calls[0][1]);
      expect(savedState.status).toBe('awaiting_follow_up');
      expect(savedState.activeTopic).toEqual(topic);
    });

    it('sets status to idle when no pendingFollowUps', async () => {
      const session = makeSession({ status: 'awaiting_follow_up' });
      mockRedis.get.mockResolvedValue(JSON.stringify(session));
      mockRedis.set.mockResolvedValue('OK');

      const topic = makeTopic({ pendingFollowUps: [] });

      await service.updateTopic('user-1', topic);

      const savedState = JSON.parse(mockRedis.set.mock.calls[0][1]);
      expect(savedState.status).toBe('idle');
    });
  });

  describe('addConversationTurn', () => {
    it('appends to activeTopic history', async () => {
      const session = makeSession({
        activeTopic: makeTopic({
          conversationHistory: [
            { role: 'user', content: 'Hello', timestamp: '2026-02-28T00:00:00Z' },
          ],
        }),
      });
      mockRedis.get.mockResolvedValue(JSON.stringify(session));
      mockRedis.set.mockResolvedValue('OK');

      const turn = {
        role: 'assistant' as const,
        content: 'Hi there!',
        timestamp: '2026-02-28T00:01:00Z',
      };

      await service.addConversationTurn('user-1', turn);

      const savedState = JSON.parse(mockRedis.set.mock.calls[0][1]);
      expect(savedState.activeTopic.conversationHistory).toHaveLength(2);
      expect(savedState.activeTopic.conversationHistory[1]).toEqual(turn);
    });
  });
});
