import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { MeetingsController } from './meetings.controller';
import { MeetingsService } from './meetings.service';
import { SharedSecretGuard } from '../auth/shared-secret.guard';

const VALID_PAYLOAD = {
  title: 'Q2 Roadmap Review',
  started_at: '2026-04-26T10:00:00Z',
  ended_at: '2026-04-26T10:47:00Z',
  attendees: ['alice@example.com', 'bob@example.com'],
  transcript: 'This is the meeting transcript.',
  source: 'fathom' as const,
};

const MOCK_INGEST_RESULT = {
  meeting_id: 'meeting-123',
  vault_path: 'raw/meetings/2026-04-26-q2-roadmap-review.md',
  commit_sha: 'deadbeef',
};

describe('MeetingsController', () => {
  let controller: MeetingsController;
  let mockIngest: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    mockIngest = vi.fn().mockResolvedValue(MOCK_INGEST_RESULT);

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MeetingsController],
      providers: [
        {
          provide: MeetingsService,
          useValue: { ingest: mockIngest },
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

    controller = module.get<MeetingsController>(MeetingsController);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('valid payload → delegates to MeetingsService.ingest and returns result', async () => {
    const result = await controller.ingest(VALID_PAYLOAD);
    expect(mockIngest).toHaveBeenCalledOnce();
    expect(result).toEqual(MOCK_INGEST_RESULT);
  });

  it('missing title → throws BadRequestException with errors field', async () => {
    const payload = { ...VALID_PAYLOAD, title: '' };
    await expect(controller.ingest(payload)).rejects.toThrow(BadRequestException);
    expect(mockIngest).not.toHaveBeenCalled();
  });

  it('transcript > 5MB → throws BadRequestException', async () => {
    const payload = { ...VALID_PAYLOAD, transcript: 'x'.repeat(5_000_001) };
    await expect(controller.ingest(payload)).rejects.toThrow(BadRequestException);
    expect(mockIngest).not.toHaveBeenCalled();
  });

  it('started_at not ISO 8601 → throws BadRequestException', async () => {
    const payload = { ...VALID_PAYLOAD, started_at: 'not-a-date' };
    await expect(controller.ingest(payload)).rejects.toThrow(BadRequestException);
    expect(mockIngest).not.toHaveBeenCalled();
  });
});
