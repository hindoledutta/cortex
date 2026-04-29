import { Test, TestingModule } from '@nestjs/testing';
import { HeartbeatStalenessService } from './heartbeat-staleness.service';
import { SchedulerService } from '../scheduler/scheduler.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationService } from '../scheduler/notification.service';
import { HeartbeatService } from './heartbeat.service';

function makeStaleRow(host: string, hoursAgo: number, lastError: string | null = null) {
  return {
    id: `hb-${host}`,
    host,
    lastSeenAt: new Date(Date.now() - hoursAgo * 3_600_000),
    lastError,
    version: null,
    lastIngestAt: null,
    queueDepth: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('HeartbeatStalenessService', () => {
  let service: HeartbeatStalenessService;
  let createQueue: ReturnType<typeof vi.fn>;
  let work: ReturnType<typeof vi.fn>;
  let schedule: ReturnType<typeof vi.fn>;
  let settingsGet: ReturnType<typeof vi.fn>;
  let sendHeartbeatStale: ReturnType<typeof vi.fn>;
  let findStale: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    createQueue = vi.fn().mockResolvedValue(undefined);
    work = vi.fn().mockResolvedValue(undefined);
    schedule = vi.fn().mockResolvedValue(undefined);
    settingsGet = vi
      .fn()
      .mockResolvedValue({ notificationHourUtc: 9, id: 'default', reminderLeadMinutes: 1440, checkInAfterDays: 3 });
    sendHeartbeatStale = vi.fn().mockResolvedValue(undefined);
    findStale = vi.fn().mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HeartbeatStalenessService,
        {
          provide: SchedulerService,
          useValue: {
            boss: { createQueue, work, schedule },
          },
        },
        {
          provide: SettingsService,
          useValue: { get: settingsGet },
        },
        {
          provide: NotificationService,
          useValue: { sendHeartbeatStale },
        },
        {
          provide: HeartbeatService,
          useValue: { findStale },
        },
      ],
    }).compile();

    service = module.get<HeartbeatStalenessService>(HeartbeatStalenessService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('onModuleInit', () => {
    it('reads settings.get() and schedules cron at notificationHourUtc=14', async () => {
      settingsGet.mockResolvedValue({
        notificationHourUtc: 14,
        id: 'default',
        reminderLeadMinutes: 1440,
        checkInAfterDays: 3,
      });

      await service.onModuleInit();

      expect(settingsGet).toHaveBeenCalledOnce();
      expect(createQueue).toHaveBeenCalledWith('heartbeat-staleness-check');
      expect(work).toHaveBeenCalledWith('heartbeat-staleness-check', expect.any(Function));
      expect(schedule).toHaveBeenCalledWith('heartbeat-staleness-check', '0 14 * * *');
    });

    it('registers cron with default notificationHourUtc=9', async () => {
      await service.onModuleInit();

      expect(schedule).toHaveBeenCalledWith('heartbeat-staleness-check', '0 9 * * *');
    });
  });

  describe('checkStale', () => {
    it('does not notify when findStale returns empty array', async () => {
      findStale.mockResolvedValue([]);
      await service.checkStale();
      expect(sendHeartbeatStale).not.toHaveBeenCalled();
    });

    it('calls sendHeartbeatStale once with correct args when 1 stale host (30h)', async () => {
      const row = makeStaleRow('mac-mini-home', 30, 'ENETUNREACH');
      findStale.mockResolvedValue([row]);

      await service.checkStale();

      expect(sendHeartbeatStale).toHaveBeenCalledOnce();
      const args = sendHeartbeatStale.mock.calls[0][0];
      expect(args.host).toBe('mac-mini-home');
      expect(args.hoursAgo).toBe(30);
      expect(args.lastError).toBe('ENETUNREACH');
    });

    it('continues to second host when notification for first host throws', async () => {
      const row1 = makeStaleRow('host-1', 30);
      const row2 = makeStaleRow('host-2', 28);
      findStale.mockResolvedValue([row1, row2]);

      sendHeartbeatStale
        .mockRejectedValueOnce(new Error('Telegram error'))
        .mockResolvedValueOnce(undefined);

      await service.checkStale();

      expect(sendHeartbeatStale).toHaveBeenCalledTimes(2);
      // Second host was still notified despite first host's failure
      expect(sendHeartbeatStale.mock.calls[1][0].host).toBe('host-2');
    });
  });
});
