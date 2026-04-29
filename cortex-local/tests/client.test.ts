import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { IngestPayload } from '../src/types.js';

// Config factory
const makeConfig = (stateDir: string) => ({
  cortexApiUrl: 'https://cortex.example.com',
  sharedSecret: 'a'.repeat(32),
  meetilyOutputDir: '/tmp/meetily',
  host: 'mac-mini-home',
  stateDir,
  frontmatterFields: {
    title: 'title',
    startedAt: 'started_at',
    endedAt: 'ended_at',
    attendees: 'attendees',
    externalId: 'meeting-id',
  },
  heartbeatCron: '0 9 * * *',
});

const SAMPLE_PAYLOAD: IngestPayload = {
  title: 'Test Meeting',
  started_at: '2026-04-26T10:00:00Z',
  ended_at: '2026-04-26T10:30:00Z',
  attendees: ['Alice'],
  transcript: 'Hello world',
  source: 'meetily',
  external_id: 'mtg-001',
};

describe('uploadWithRetry', () => {
  let tmpDir: string;
  let uploadWithRetry: typeof import('../src/client.js').uploadWithRetry;
  let getRuntimeState: typeof import('../src/client.js').getRuntimeState;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-client-test-'));
    // Re-import to get fresh module (vitest reuses modules across tests so we use fresh config per test)
    const mod = await import('../src/client.js');
    uploadWithRetry = mod.uploadWithRetry;
    getRuntimeState = mod.getRuntimeState;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('200 OK — returns parsed JSON; writes runtime state with lastIngestAt set, lastError: null', async () => {
    const mockResponse = {
      meeting_id: 'meet-123',
      vault_path: 'raw/meetings/2026-04-26-test-meeting.md',
      commit_sha: 'abc123',
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    }));

    const config = makeConfig(tmpDir);
    // Use zero timeouts to avoid real delays
    const result = await uploadWithRetry(config, SAMPLE_PAYLOAD);
    expect(result.meeting_id).toBe('meet-123');

    const runtime = await getRuntimeState(tmpDir);
    expect(runtime.lastError).toBeNull();
    expect(runtime.lastIngestAt).toBeTruthy();
  });

  it('401 — throws AbortError immediately; fetch called exactly once; writes lastError', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });
    vi.stubGlobal('fetch', mockFetch);

    const config = makeConfig(tmpDir);
    await expect(uploadWithRetry(config, SAMPLE_PAYLOAD)).rejects.toThrow();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const runtime = await getRuntimeState(tmpDir);
    expect(runtime.lastError).toBeTruthy();
    expect(runtime.lastError).toContain('401');
  });

  it('400 — throws AbortError immediately; fetch called exactly once', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'Bad Request: invalid payload',
    });
    vi.stubGlobal('fetch', mockFetch);

    const config = makeConfig(tmpDir);
    await expect(uploadWithRetry(config, SAMPLE_PAYLOAD)).rejects.toThrow();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('500 then 200 — eventually succeeds', async () => {
    const successResponse = {
      meeting_id: 'meet-456',
      vault_path: 'raw/meetings/test.md',
      commit_sha: 'def456',
    };
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'Server Error' })
      .mockResolvedValue({ ok: true, status: 200, json: async () => successResponse });

    vi.stubGlobal('fetch', mockFetch);

    const config = {
      ...makeConfig(tmpDir),
      // Override to make retry fast (pRetry uses minTimeout only for actual delays in async context)
    };

    // We need to override p-retry's minTimeout for fast tests.
    // The easiest approach: since p-retry uses setTimeout internally,
    // we use vi.useFakeTimers to advance time.
    vi.useFakeTimers();

    const promise = uploadWithRetry(config, SAMPLE_PAYLOAD);

    // Advance time to bypass retry timeout (minTimeout=60s by default)
    await vi.runAllTimersAsync();

    const result = await promise;
    expect(result.meeting_id).toBe('meet-456');
    expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(2);
    vi.useRealTimers();
  });

  it('repeated 500 — throws after retries exhausted; writes lastError', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Server Error',
    });
    vi.stubGlobal('fetch', mockFetch);

    vi.useFakeTimers();

    const config = makeConfig(tmpDir);
    const promise = uploadWithRetry(config, SAMPLE_PAYLOAD);
    await vi.runAllTimersAsync();

    await expect(promise).rejects.toThrow();

    const runtime = await getRuntimeState(tmpDir);
    expect(runtime.lastError).toBeTruthy();
    vi.useRealTimers();
  });

  it('network error (fetch throws) — retried', async () => {
    const mockFetch = vi.fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ meeting_id: 'meet-789', vault_path: 'raw/meetings/test.md', commit_sha: 'ghi789' }),
      });

    vi.stubGlobal('fetch', mockFetch);
    vi.useFakeTimers();

    const promise = uploadWithRetry(makeConfig(tmpDir), SAMPLE_PAYLOAD);
    await vi.runAllTimersAsync();

    const result = await promise;
    expect(result.meeting_id).toBe('meet-789');
    expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(2);
    vi.useRealTimers();
  });

  it('Authorization header is exactly "Bearer <sharedSecret>"', async () => {
    const sharedSecret = 'b'.repeat(32);
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ meeting_id: 'meet-000', vault_path: 'raw/meetings/test.md', commit_sha: '000' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const config = { ...makeConfig(tmpDir), sharedSecret };
    await uploadWithRetry(config, SAMPLE_PAYLOAD);

    const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = callArgs[1].headers as Record<string, string>;
    expect(headers['Authorization']).toBe(`Bearer ${sharedSecret}`);
  });
});
