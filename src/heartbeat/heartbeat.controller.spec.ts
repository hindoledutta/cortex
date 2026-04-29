import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { HeartbeatController } from './heartbeat.controller';
import { HeartbeatService } from './heartbeat.service';
import { SharedSecretGuard } from '../auth/shared-secret.guard';

const VALID_PAYLOAD = {
  host: 'mac-mini-home',
  version: '1.0.0',
};

const UPSERT_RESULT = {
  host: 'mac-mini-home',
  lastSeenAt: new Date('2026-04-30T01:00:00Z'),
};

describe('HeartbeatController', () => {
  let controller: HeartbeatController;
  let mockUpsert: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    mockUpsert = vi.fn().mockResolvedValue(UPSERT_RESULT);

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HeartbeatController],
      providers: [
        {
          provide: HeartbeatService,
          useValue: { upsert: mockUpsert },
        },
        {
          provide: SharedSecretGuard,
          useValue: { canActivate: vi.fn().mockReturnValue(true) },
        },
      ],
    })
      .overrideGuard(SharedSecretGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<HeartbeatController>(HeartbeatController);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('valid payload → returns { ok: true, last_seen_at: <iso> }', async () => {
    const result = await controller.ingest(VALID_PAYLOAD);
    expect(mockUpsert).toHaveBeenCalledOnce();
    expect(result.ok).toBe(true);
    expect(result.last_seen_at).toBe(UPSERT_RESULT.lastSeenAt.toISOString());
  });

  it('missing host → throws BadRequestException', async () => {
    await expect(controller.ingest({})).rejects.toThrow(BadRequestException);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('last_error longer than 2000 chars → throws BadRequestException', async () => {
    const payload = { ...VALID_PAYLOAD, last_error: 'x'.repeat(2001) };
    await expect(controller.ingest(payload)).rejects.toThrow(BadRequestException);
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});
