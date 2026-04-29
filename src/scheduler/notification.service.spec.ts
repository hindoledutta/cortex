import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getBotToken } from 'nestjs-telegraf';
import { NotificationService } from './notification.service';

const OWNER_CHAT_ID = 123456;

function makeSendMessage() {
  return vi.fn().mockResolvedValue({});
}

async function createModule(sendMessage: ReturnType<typeof vi.fn>) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      NotificationService,
      {
        provide: getBotToken(),
        useValue: {
          telegram: { sendMessage },
        },
      },
      {
        provide: ConfigService,
        useValue: {
          getOrThrow: vi.fn().mockReturnValue(String(OWNER_CHAT_ID)),
        },
      },
    ],
  }).compile();
  return module.get<NotificationService>(NotificationService);
}

describe('NotificationService — new Phase 7b methods', () => {
  let sendMessage: ReturnType<typeof vi.fn>;
  let service: NotificationService;

  beforeEach(async () => {
    sendMessage = makeSendMessage();
    service = await createModule(sendMessage);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------- sendMeetingCaptured ----------

  describe('sendMeetingCaptured', () => {
    it('sends message with 📝 Meeting captured header, title, and vault path', async () => {
      const startedAt = new Date('2026-04-26T10:00:00Z');
      const endedAt = new Date('2026-04-26T10:47:00Z');

      await service.sendMeetingCaptured({
        title: 'Q2 Roadmap Review',
        startedAt,
        endedAt,
        attendeeCount: 3,
        vaultPath: 'raw/meetings/2026-04-26-q2-roadmap-review.md',
      });

      expect(sendMessage).toHaveBeenCalledOnce();
      const [chatId, text, opts] = sendMessage.mock.calls[0];
      expect(chatId).toBe(OWNER_CHAT_ID);
      expect(text).toContain('📝 Meeting captured');
      expect(text).toContain('Q2 Roadmap Review');
      expect(text).toContain('47 min');
      expect(text).toContain('3 attendees');
      expect(text).toContain('<code>raw/meetings/2026-04-26-q2-roadmap-review.md</code>');
      expect(opts).toEqual({ parse_mode: 'HTML' });
    });

    it('HTML-escapes the title', async () => {
      const startedAt = new Date('2026-04-26T10:00:00Z');
      const endedAt = new Date('2026-04-26T10:30:00Z');

      await service.sendMeetingCaptured({
        title: '<b>Bad</b>',
        startedAt,
        endedAt,
        attendeeCount: 1,
        vaultPath: 'raw/meetings/2026-04-26-bad.md',
      });

      const text = sendMessage.mock.calls[0][1] as string;
      expect(text).toContain('&lt;b&gt;Bad&lt;/b&gt;');
      expect(text).not.toContain('<b>Bad</b>');
    });

    it('renders "1 attendee" for single attendee', async () => {
      const startedAt = new Date('2026-04-26T09:00:00Z');
      const endedAt = new Date('2026-04-26T09:30:00Z');

      await service.sendMeetingCaptured({
        title: 'Solo Call',
        startedAt,
        endedAt,
        attendeeCount: 1,
        vaultPath: 'raw/meetings/2026-04-26-solo-call.md',
      });

      const text = sendMessage.mock.calls[0][1] as string;
      expect(text).toContain('1 attendee');
      expect(text).not.toContain('1 attendees');
    });

    it('renders "3 attendees" for multiple attendees', async () => {
      const startedAt = new Date('2026-04-26T09:00:00Z');
      const endedAt = new Date('2026-04-26T09:30:00Z');

      await service.sendMeetingCaptured({
        title: 'Team Call',
        startedAt,
        endedAt,
        attendeeCount: 3,
        vaultPath: 'raw/meetings/2026-04-26-team-call.md',
      });

      const text = sendMessage.mock.calls[0][1] as string;
      expect(text).toContain('3 attendees');
    });
  });

  // ---------- sendHeartbeatStale ----------

  describe('sendHeartbeatStale', () => {
    it('sends message with host, hoursAgo, no error line when lastError is absent', async () => {
      await service.sendHeartbeatStale({ host: 'mac-mini-home', hoursAgo: 30 });

      expect(sendMessage).toHaveBeenCalledOnce();
      const [chatId, text, opts] = sendMessage.mock.calls[0];
      expect(chatId).toBe(OWNER_CHAT_ID);
      expect(text).toContain('mac-mini-home');
      expect(text).toContain('30');
      expect(text).not.toContain('Last reported error');
      expect(opts).toEqual({ parse_mode: 'HTML' });
    });

    it('includes "Last reported error" line when lastError is provided', async () => {
      await service.sendHeartbeatStale({
        host: 'mac-mini-home',
        hoursAgo: 28,
        lastError: 'ENETUNREACH',
      });

      const text = sendMessage.mock.calls[0][1] as string;
      expect(text).toContain('Last reported error');
      expect(text).toContain('ENETUNREACH');
    });

    it('does not include error line when lastError is null', async () => {
      await service.sendHeartbeatStale({ host: 'mac-mini-home', hoursAgo: 27, lastError: null });
      const text = sendMessage.mock.calls[0][1] as string;
      expect(text).not.toContain('Last reported error');
    });

    it('HTML-escapes the host', async () => {
      await service.sendHeartbeatStale({ host: '<script>', hoursAgo: 30 });
      const text = sendMessage.mock.calls[0][1] as string;
      expect(text).toContain('&lt;script&gt;');
      expect(text).not.toContain('<script>');
    });
  });

  // ---------- sendUploadFailed ----------

  describe('sendUploadFailed', () => {
    it('calls sendMessage exactly once with parse_mode HTML and correct structure', async () => {
      await service.sendUploadFailed({ host: 'mac-mini-home', error: 'ENETUNREACH' });

      expect(sendMessage).toHaveBeenCalledOnce();
      const [chatId, text, opts] = sendMessage.mock.calls[0];
      expect(chatId).toBe(OWNER_CHAT_ID);
      expect(text).toContain('⚠ <b>cortex-local upload failed</b>');
      expect(text).toContain('<code>mac-mini-home</code>');
      expect(text).toContain('<code>ENETUNREACH</code>');
      expect(text).toContain('Meeting capture is paused');
      expect(opts).toEqual({ parse_mode: 'HTML' });
    });

    it('truncates long errors to 500 chars before HTML-escaping', async () => {
      const longError = 'x'.repeat(600);
      await service.sendUploadFailed({ host: 'mac-mini-home', error: longError });

      const text = sendMessage.mock.calls[0][1] as string;
      // The error inside <code> should be at most 500 'x' chars
      const match = text.match(/<code>(x+)<\/code>/);
      expect(match).not.toBeNull();
      expect(match![1].length).toBe(500);
    });

    it('HTML-escapes error containing injection attempt', async () => {
      await service.sendUploadFailed({
        host: 'mac-mini-home',
        error: '<script>alert(1)</script>',
      });

      const text = sendMessage.mock.calls[0][1] as string;
      expect(text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
      expect(text).not.toContain('<script>alert(1)</script>');
    });
  });

  // ---------- formatDuration ----------

  describe('formatDuration', () => {
    it('returns "47 min" for 47-minute window', () => {
      const s = new Date('2026-04-26T10:00:00Z');
      const e = new Date('2026-04-26T10:47:00Z');
      expect(NotificationService.formatDuration(s, e)).toBe('47 min');
    });

    it('returns "1h 0m" for exactly 60 minutes', () => {
      const s = new Date('2026-04-26T10:00:00Z');
      const e = new Date('2026-04-26T11:00:00Z');
      expect(NotificationService.formatDuration(s, e)).toBe('1h 0m');
    });

    it('returns "1h 12m" for 72 minutes', () => {
      const s = new Date('2026-04-26T10:00:00Z');
      const e = new Date('2026-04-26T11:12:00Z');
      expect(NotificationService.formatDuration(s, e)).toBe('1h 12m');
    });

    it('returns "1 min" for 1 minute', () => {
      const s = new Date('2026-04-26T10:00:00Z');
      const e = new Date('2026-04-26T10:01:00Z');
      expect(NotificationService.formatDuration(s, e)).toBe('1 min');
    });

    it('returns "0 min" when start equals end', () => {
      const s = new Date('2026-04-26T10:00:00Z');
      expect(NotificationService.formatDuration(s, s)).toBe('0 min');
    });

    it('returns "0 min" when end is before start (Math.max guard)', () => {
      const s = new Date('2026-04-26T10:00:00Z');
      const e = new Date('2026-04-26T09:00:00Z');
      expect(NotificationService.formatDuration(s, e)).toBe('0 min');
    });
  });
});
