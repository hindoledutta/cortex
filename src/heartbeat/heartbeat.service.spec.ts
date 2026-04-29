import { Test, TestingModule } from '@nestjs/testing';
import { HeartbeatService } from './heartbeat.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../scheduler/notification.service';

const BASE_ROW = {
  id: 'hb-1',
  host: 'mac-mini-home',
  version: null,
  lastSeenAt: new Date(),
  lastIngestAt: null,
  queueDepth: null,
  lastError: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('HeartbeatService', () => {
  let service: HeartbeatService;
  let heartbeatFindUnique: ReturnType<typeof vi.fn>;
  let heartbeatUpsert: ReturnType<typeof vi.fn>;
  let heartbeatFindMany: ReturnType<typeof vi.fn>;
  let sendUploadFailed: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    heartbeatFindUnique = vi.fn().mockResolvedValue(null);
    heartbeatUpsert = vi.fn().mockImplementation(({ create }) =>
      Promise.resolve({ ...BASE_ROW, ...create }),
    );
    heartbeatFindMany = vi.fn().mockResolvedValue([]);
    sendUploadFailed = vi.fn().mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HeartbeatService,
        {
          provide: PrismaService,
          useValue: {
            heartbeat: {
              findUnique: heartbeatFindUnique,
              upsert: heartbeatUpsert,
              findMany: heartbeatFindMany,
            },
          },
        },
        {
          provide: NotificationService,
          useValue: { sendUploadFailed },
        },
      ],
    }).compile();

    service = module.get<HeartbeatService>(HeartbeatService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('upsert — MEET-06 escalation', () => {
    it('1. fresh insert with no error — upsert called, sendUploadFailed NOT called', async () => {
      heartbeatFindUnique.mockResolvedValue(null);

      await service.upsert({ host: 'mac-mini-home' });

      expect(heartbeatUpsert).toHaveBeenCalledOnce();
      // Allow microtask flush
      await Promise.resolve();
      expect(sendUploadFailed).not.toHaveBeenCalled();
    });

    it('2. fresh insert WITH error (null → string transition) — sendUploadFailed called exactly once', async () => {
      heartbeatFindUnique.mockResolvedValue(null);

      await service.upsert({ host: 'mac-mini-home', last_error: 'ENETUNREACH' });

      expect(heartbeatUpsert).toHaveBeenCalledOnce();
      await Promise.resolve();
      expect(sendUploadFailed).toHaveBeenCalledOnce();
      expect(sendUploadFailed).toHaveBeenCalledWith({
        host: 'mac-mini-home',
        error: 'ENETUNREACH',
      });
    });

    it('3. repeated same error — sendUploadFailed NOT called (de-dupe)', async () => {
      heartbeatFindUnique.mockResolvedValue({ ...BASE_ROW, lastError: 'ENETUNREACH' });

      await service.upsert({ host: 'mac-mini-home', last_error: 'ENETUNREACH' });

      await Promise.resolve();
      expect(sendUploadFailed).not.toHaveBeenCalled();
    });

    it('4. changed error (string → different string) — sendUploadFailed called once with NEW error', async () => {
      heartbeatFindUnique.mockResolvedValue({ ...BASE_ROW, lastError: 'ENETUNREACH' });

      await service.upsert({ host: 'mac-mini-home', last_error: '413 payload too large' });

      await Promise.resolve();
      expect(sendUploadFailed).toHaveBeenCalledOnce();
      expect(sendUploadFailed).toHaveBeenCalledWith({
        host: 'mac-mini-home',
        error: '413 payload too large',
      });
    });

    it('5. recovery (string → null) — sendUploadFailed NOT called', async () => {
      heartbeatFindUnique.mockResolvedValue({ ...BASE_ROW, lastError: 'ENETUNREACH' });

      await service.upsert({ host: 'mac-mini-home', last_error: null });

      await Promise.resolve();
      expect(sendUploadFailed).not.toHaveBeenCalled();
    });

    it('6. last_error omitted entirely (undefined) → treated as null → no notification', async () => {
      heartbeatFindUnique.mockResolvedValue(null);
      // last_error field omitted entirely
      await service.upsert({ host: 'mac-mini-home' });

      await Promise.resolve();
      expect(sendUploadFailed).not.toHaveBeenCalled();
    });

    it('7. sendUploadFailed rejection does NOT fail the upsert', async () => {
      heartbeatFindUnique.mockResolvedValue(null);
      sendUploadFailed.mockRejectedValue(new Error('Telegram down'));

      const result = await service.upsert({ host: 'mac-mini-home', last_error: 'ENETUNREACH' });

      // Upsert still succeeds
      expect(result.host).toBe('mac-mini-home');
      expect(result.lastSeenAt).toBeInstanceOf(Date);

      // Allow rejection to settle
      await new Promise((r) => setTimeout(r, 10));
      // sendUploadFailed was called but rejection was swallowed
      expect(sendUploadFailed).toHaveBeenCalledOnce();
    });
  });

  describe('findStale', () => {
    it('calls prisma.heartbeat.findMany with lastSeenAt lt cutoff', async () => {
      const cutoff = new Date('2026-04-29T00:00:00Z');
      heartbeatFindMany.mockResolvedValue([BASE_ROW]);

      const result = await service.findStale(cutoff);

      expect(heartbeatFindMany).toHaveBeenCalledWith({
        where: { lastSeenAt: { lt: cutoff } },
      });
      expect(result).toEqual([BASE_ROW]);
    });
  });
});
