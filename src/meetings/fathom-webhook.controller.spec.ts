import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { FathomWebhookController } from './fathom-webhook.controller';
import { MeetingsService } from './meetings.service';
import { FathomWebhookGuard } from '../auth/fathom-webhook.guard';

const MOCK_INGEST_RESULT = {
  meeting_id: 'meeting-abc',
  vault_path: 'raw/meetings/2026-05-01-team-standup.md',
  commit_sha: 'cafe1234',
};

const VALID_PAYLOAD = {
  id: 42,
  recording_id: 7,
  title: 'Team Standup',
  started_at: '2026-05-01T09:00:00Z',
  ended_at: '2026-05-01T09:30:00Z',
  calendar_invitees: [{ email: 'alice@example.com' }, { email: 'bob@example.com' }],
  transcript: [
    { speaker: { display_name: 'Alice' }, text: 'Good morning everyone.', timestamp: '00:00:05' },
    { speaker: { display_name: 'Bob' }, text: 'Hi Alice!', timestamp: '00:00:10' },
  ],
  summary: { markdown_formatted: '## Summary\nShort standup.' },
  action_items: ['Alice to update the board', 'Bob to review PR #42'],
};

describe('FathomWebhookController', () => {
  let controller: FathomWebhookController;
  let mockIngest: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    mockIngest = vi.fn().mockResolvedValue(MOCK_INGEST_RESULT);

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FathomWebhookController],
      providers: [
        { provide: MeetingsService, useValue: { ingest: mockIngest } },
        { provide: FathomWebhookGuard, useValue: { canActivate: vi.fn().mockReturnValue(true) } },
      ],
    })
      .overrideGuard(FathomWebhookGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<FathomWebhookController>(FathomWebhookController);
  });

  afterEach(() => vi.restoreAllMocks());

  it('valid full payload → calls ingest with source=fathom, external_id=String(recording_id)', async () => {
    await controller.handleWebhook(VALID_PAYLOAD);

    expect(mockIngest).toHaveBeenCalledOnce();
    const arg = mockIngest.mock.calls[0][0];
    expect(arg.source).toBe('fathom');
    expect(arg.external_id).toBe('7');
    expect(arg.title).toBe('Team Standup');
    expect(arg.attendees).toEqual(['alice@example.com', 'bob@example.com']);
    expect(arg.started_at).toBe('2026-05-01T09:00:00.000Z');
  });

  it('formats transcript lines as "[HH:MM:SS] Speaker: text"', async () => {
    await controller.handleWebhook(VALID_PAYLOAD);

    const arg = mockIngest.mock.calls[0][0];
    expect(arg.transcript).toContain('[00:00:05] Alice: Good morning everyone.');
    expect(arg.transcript).toContain('[00:00:10] Bob: Hi Alice!');
  });

  it('passes summary and action_items through to ingest payload', async () => {
    await controller.handleWebhook(VALID_PAYLOAD);

    const arg = mockIngest.mock.calls[0][0];
    expect(arg.summary).toBe('## Summary\nShort standup.');
    expect(arg.action_items).toEqual([
      'Alice to update the board',
      'Bob to review PR #42',
    ]);
  });

  it('missing transcript → ingest called with "(no transcript)"', async () => {
    const payload = { ...VALID_PAYLOAD, transcript: undefined };
    await controller.handleWebhook(payload);

    const arg = mockIngest.mock.calls[0][0];
    expect(arg.transcript).toBe('(no transcript)');
  });

  it('action_items as {text} objects → flattened to string array', async () => {
    const payload = {
      ...VALID_PAYLOAD,
      action_items: [{ text: 'Deploy to prod' }, { text: 'Write tests' }],
    };
    await controller.handleWebhook(payload);

    const arg = mockIngest.mock.calls[0][0];
    expect(arg.action_items).toEqual(['Deploy to prod', 'Write tests']);
  });

  it('no started_at → falls back to created_at', async () => {
    const payload = {
      ...VALID_PAYLOAD,
      started_at: undefined,
      created_at: '2026-05-01T08:55:00Z',
    };
    await controller.handleWebhook(payload);

    const arg = mockIngest.mock.calls[0][0];
    expect(arg.started_at).toBe('2026-05-01T08:55:00.000Z');
  });

  it('no title → falls back to meeting_name', async () => {
    const payload = { ...VALID_PAYLOAD, title: undefined, meeting_name: 'Weekly Sync' };
    await controller.handleWebhook(payload);

    const arg = mockIngest.mock.calls[0][0];
    expect(arg.title).toBe('Weekly Sync');
  });

  it('no title or meeting_name → generates fallback title with id', async () => {
    const payload = { ...VALID_PAYLOAD, title: undefined, meeting_name: undefined };
    await controller.handleWebhook(payload);

    const arg = mockIngest.mock.calls[0][0];
    expect(arg.title).toBe(`Fathom Meeting ${VALID_PAYLOAD.id}`);
  });

  it('invalid payload (missing id) → throws BadRequestException', async () => {
    const payload = { recording_id: 7, title: 'No ID' };
    await expect(controller.handleWebhook(payload)).rejects.toThrow(BadRequestException);
    expect(mockIngest).not.toHaveBeenCalled();
  });
});
