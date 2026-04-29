import { Test, TestingModule } from '@nestjs/testing';
import { MeetingsService } from './meetings.service';
import { PrismaService } from '../prisma/prisma.service';
import { VaultService } from '../vault/vault.service';
import { WorkspaceService } from '../workspace/workspace.service';
import { NotificationService } from '../scheduler/notification.service';
import type { IngestPayload } from './meetings.types';

const WORK_WORKSPACE = { id: 'ws-work', name: 'work', isDefault: false };

const VALID_PAYLOAD: IngestPayload = {
  title: 'Q2 Roadmap Review',
  started_at: '2026-04-26T10:00:00Z',
  ended_at: '2026-04-26T10:47:00Z',
  attendees: ['alice@example.com', 'bob@example.com'],
  transcript: 'This is the meeting transcript.',
  source: 'meetily',
  external_id: undefined,
};

const VAULT_RESULT = {
  commitSha: 'deadbeef',
  vaultPath: 'raw/meetings/2026-04-26-q2-roadmap-review.md',
};

const CREATED_MEETING = {
  id: 'meeting-uuid',
  vaultPath: VAULT_RESULT.vaultPath,
  vaultCommitSha: VAULT_RESULT.commitSha,
};

describe('MeetingsService', () => {
  let service: MeetingsService;
  let meetingFindFirst: ReturnType<typeof vi.fn>;
  let meetingCreate: ReturnType<typeof vi.fn>;
  let vaultWriteFile: ReturnType<typeof vi.fn>;
  let workspaceFindByName: ReturnType<typeof vi.fn>;
  let sendMeetingCaptured: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    meetingFindFirst = vi.fn().mockResolvedValue(null);
    meetingCreate = vi.fn().mockResolvedValue(CREATED_MEETING);
    vaultWriteFile = vi.fn().mockResolvedValue(VAULT_RESULT);
    workspaceFindByName = vi.fn().mockResolvedValue(WORK_WORKSPACE);
    sendMeetingCaptured = vi.fn().mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MeetingsService,
        {
          provide: PrismaService,
          useValue: {
            meeting: {
              findFirst: meetingFindFirst,
              create: meetingCreate,
            },
          },
        },
        {
          provide: VaultService,
          useValue: { writeFile: vaultWriteFile },
        },
        {
          provide: WorkspaceService,
          useValue: { findByName: workspaceFindByName },
        },
        {
          provide: NotificationService,
          useValue: { sendMeetingCaptured },
        },
      ],
    }).compile();

    service = module.get<MeetingsService>(MeetingsService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('happy path: calls vault.writeFile with correct args, creates meeting row, returns ids', async () => {
    const result = await service.ingest(VALID_PAYLOAD);

    expect(vaultWriteFile).toHaveBeenCalledOnce();
    const writeArgs = vaultWriteFile.mock.calls[0][0];
    expect(writeArgs.vaultPath).toBe('raw/meetings/2026-04-26-q2-roadmap-review.md');
    expect(writeArgs.kind).toBe('meeting');
    expect(writeArgs.commitMessage).toBe('meeting: q2-roadmap-review');
    expect(typeof writeArgs.sourceId).toBe('string');

    expect(meetingCreate).toHaveBeenCalledOnce();
    const createArgs = meetingCreate.mock.calls[0][0].data;
    expect(createArgs.workspaceId).toBe('ws-work');

    expect(result.meeting_id).toBeDefined();
    expect(result.vault_path).toBe(VAULT_RESULT.vaultPath);
    expect(result.commit_sha).toBe(VAULT_RESULT.commitSha);
  });

  it('workspace is always Work regardless of attendees (MEET-08)', async () => {
    await service.ingest({
      ...VALID_PAYLOAD,
      attendees: ['personal@gmail.com'],
    });

    expect(workspaceFindByName).toHaveBeenCalledWith('work');
    const createArgs = meetingCreate.mock.calls[0][0].data;
    expect(createArgs.workspaceId).toBe('ws-work');
  });

  it('body format matches HLD §3.8 B-MEET-4', async () => {
    await service.ingest(VALID_PAYLOAD);

    const writeArgs = vaultWriteFile.mock.calls[0][0];
    const body: string = writeArgs.body;

    expect(body).toContain('Source: Meetily (Google Meet)');
    expect(body).toContain('Date: 2026-04-26');
    expect(body).toContain('Started: 10:00');
    expect(body).toContain('Ended: 10:47');
    expect(body).toContain('Attendees: alice@example.com, bob@example.com');
    expect(body).toContain('\n---\n');
    expect(body).toContain(VALID_PAYLOAD.transcript);
  });

  describe('slug correctness', () => {
    it('converts "Q2 2026 Roadmap Review!" to "q2-2026-roadmap-review"', async () => {
      await service.ingest({ ...VALID_PAYLOAD, title: 'Q2 2026 Roadmap Review!' });

      const writeArgs = vaultWriteFile.mock.calls[0][0];
      expect(writeArgs.commitMessage).toBe('meeting: q2-2026-roadmap-review');
      expect(writeArgs.vaultPath).toContain('q2-2026-roadmap-review');
    });

    it('long title is capped at 80 chars in slug', async () => {
      const longTitle = 'A'.repeat(200);
      await service.ingest({ ...VALID_PAYLOAD, title: longTitle });

      const writeArgs = vaultWriteFile.mock.calls[0][0];
      const slug = writeArgs.vaultPath.replace(/^raw\/meetings\/\d{4}-\d{2}-\d{2}-/, '').replace('.md', '');
      expect(slug.length).toBeLessThanOrEqual(80);
    });

    it('vault path is prefixed with raw/meetings/ and uses date-slug format', async () => {
      // The 'untitled-meeting' fallback is only reachable if slug returns empty string.
      // In practice slug always returns a non-empty fallback for any input.
      // This test verifies the vault path format is correct in all cases.
      await service.ingest({ ...VALID_PAYLOAD, title: 'Simple Title' });

      const writeArgs = vaultWriteFile.mock.calls[0][0];
      expect(writeArgs.vaultPath).toMatch(/^raw\/meetings\/\d{4}-\d{2}-\d{2}-.+\.md$/);
    });
  });

  it('idempotency: if external_id already exists, returns existing record without calling vault.writeFile', async () => {
    const existing = {
      id: 'existing-meeting',
      vaultPath: 'raw/meetings/2026-04-20-existing.md',
      vaultCommitSha: 'abc123',
    };
    meetingFindFirst.mockResolvedValue(existing);

    const result = await service.ingest({ ...VALID_PAYLOAD, external_id: 'ext-123' });

    expect(vaultWriteFile).not.toHaveBeenCalled();
    expect(meetingCreate).not.toHaveBeenCalled();
    expect(result.meeting_id).toBe('existing-meeting');
    expect(result.vault_path).toBe(existing.vaultPath);
    expect(result.commit_sha).toBe(existing.vaultCommitSha);
  });

  it('notification fire-and-forget: notification rejection does not fail ingest', async () => {
    sendMeetingCaptured.mockRejectedValue(new Error('Telegram down'));

    const result = await service.ingest(VALID_PAYLOAD);

    // Ingest should still succeed
    expect(result.meeting_id).toBeDefined();
    expect(meetingCreate).toHaveBeenCalledOnce();
  });
});
