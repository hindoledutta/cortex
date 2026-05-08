import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Config } from '../src/config.js';

vi.mock('node-cron', () => ({
  default: { schedule: vi.fn() },
}));

vi.mock('../src/client.js', () => ({
  getRuntimeState: vi.fn().mockResolvedValue({ lastIngestAt: null, lastError: null }),
  uploadWithRetry: vi.fn(),
}));

vi.mock('../src/queue.js', () => ({
  depth: vi.fn().mockResolvedValue(0),
  enqueue: vi.fn(),
  dequeue: vi.fn(),
  drain: vi.fn(),
}));

const makeConfig = (stateDir: string): Config => ({
  cortexApiUrl: 'https://cortex.example.com',
  sharedSecret: 'a'.repeat(32),
  meetilyOutputDir: '/tmp/meetily',
  host: 'mac-mini-home',
  stateDir,
  heartbeatCron: '0 9 * * *',
});

describe('pingHeartbeat', () => {
  let tmpDir: string;
  let pingHeartbeat: typeof import('../src/heartbeat.js').pingHeartbeat;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-heartbeat-test-'));
    vi.clearAllMocks();
    const mod = await import('../src/heartbeat.js');
    pingHeartbeat = mod.pingHeartbeat;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('POSTs to ${cortexApiUrl}/api/heartbeat with expected JSON body and Bearer header; writes heartbeat.json on 200 OK', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, last_seen_at: '2026-04-26T09:00:00Z' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const config = makeConfig(tmpDir);
    await pingHeartbeat(config);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://cortex.example.com/api/heartbeat');

    const headers = opts.headers as Record<string, string>;
    expect(headers['Authorization']).toBe(`Bearer ${'a'.repeat(32)}`);

    const body = JSON.parse(opts.body as string) as Record<string, unknown>;
    expect(body['host']).toBe('mac-mini-home');

    // heartbeat.json written
    const heartbeatPath = path.join(tmpDir, 'heartbeat.json');
    const stored = JSON.parse(await fs.readFile(heartbeatPath, 'utf8')) as { lastHeartbeatAt: string };
    expect(stored.lastHeartbeatAt).toBeTruthy();
  });

  it('includes queue_depth from depth() and last_error from runtime state', async () => {
    const { depth: depthMock } = await import('../src/queue.js');
    (depthMock as ReturnType<typeof vi.fn>).mockResolvedValue(3);

    const { getRuntimeState: getRuntimeStateMock } = await import('../src/client.js');
    (getRuntimeStateMock as ReturnType<typeof vi.fn>).mockResolvedValue({
      lastIngestAt: '2026-04-26T08:00:00Z',
      lastError: 'auth failed (401)',
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, last_seen_at: '2026-04-26T09:00:00Z' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const config = makeConfig(tmpDir);
    await pingHeartbeat(config);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string) as Record<string, unknown>;
    expect(body['queue_depth']).toBe(3);
    expect(body['last_error']).toBe('auth failed (401)');
  });
});

describe('startHeartbeat', () => {
  let tmpDir: string;
  let startHeartbeat: typeof import('../src/heartbeat.js').startHeartbeat;
  let pingHeartbeat: typeof import('../src/heartbeat.js').pingHeartbeat;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-heartbeat-start-test-'));
    vi.clearAllMocks();
    const mod = await import('../src/heartbeat.js');
    startHeartbeat = mod.startHeartbeat;
    pingHeartbeat = mod.pingHeartbeat;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('calls pingHeartbeat immediately when heartbeat.json is missing', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, last_seen_at: new Date().toISOString() }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const config = makeConfig(tmpDir);
    await startHeartbeat(config);

    // Allow the fire-and-forget catch-up ping to run
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockFetch).toHaveBeenCalled();
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/heartbeat');
  });

  it('calls pingHeartbeat immediately when lastHeartbeatAt is >24h old', async () => {
    // Write a stale heartbeat (25 hours ago)
    const staleTime = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const heartbeatFile = path.join(tmpDir, 'heartbeat.json');
    await fs.mkdir(tmpDir, { recursive: true });
    await fs.writeFile(heartbeatFile, JSON.stringify({ lastHeartbeatAt: staleTime }));

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, last_seen_at: new Date().toISOString() }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const config = makeConfig(tmpDir);
    await startHeartbeat(config);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockFetch).toHaveBeenCalled();
  });

  it('does NOT call pingHeartbeat immediately when lastHeartbeatAt is <24h old', async () => {
    // Write a recent heartbeat (1 hour ago)
    const recentTime = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
    const heartbeatFile = path.join(tmpDir, 'heartbeat.json');
    await fs.mkdir(tmpDir, { recursive: true });
    await fs.writeFile(heartbeatFile, JSON.stringify({ lastHeartbeatAt: recentTime }));

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, last_seen_at: new Date().toISOString() }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const config = makeConfig(tmpDir);
    await startHeartbeat(config);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('cron.schedule called with the cron expression from config and { timezone: "UTC" }', async () => {
    // Write recent heartbeat to avoid catch-up ping (which requires fetch mock)
    const recentTime = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
    const heartbeatFile = path.join(tmpDir, 'heartbeat.json');
    await fs.mkdir(tmpDir, { recursive: true });
    await fs.writeFile(heartbeatFile, JSON.stringify({ lastHeartbeatAt: recentTime }));

    const cron = await import('node-cron');
    const scheduleSpy = cron.default.schedule as ReturnType<typeof vi.fn>;

    const config = makeConfig(tmpDir);
    await startHeartbeat(config);

    expect(scheduleSpy).toHaveBeenCalledWith(
      '0 9 * * *',
      expect.any(Function),
      { timezone: 'UTC' },
    );
  });
});
