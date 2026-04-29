import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Config } from '../src/config.js';
import type { IngestPayload } from '../src/types.js';

// Mock external dependencies
vi.mock('chokidar', () => ({
  default: {
    watch: vi.fn().mockReturnValue({
      on: vi.fn().mockReturnThis(),
    }),
  },
}));

vi.mock('../src/client.js', () => ({
  uploadWithRetry: vi.fn(),
  getRuntimeState: vi.fn().mockResolvedValue({ lastIngestAt: null, lastError: null }),
}));

vi.mock('../src/ingest-marker.js', () => ({
  markIngested: vi.fn().mockImplementation(async (p: string) => `${path.dirname(p)}/_ingested/${path.basename(p)}`),
}));

vi.mock('../src/queue.js', () => ({
  enqueue: vi.fn().mockResolvedValue(undefined),
  dequeue: vi.fn().mockResolvedValue(undefined),
  drain: vi.fn().mockResolvedValue(undefined),
  depth: vi.fn().mockResolvedValue(0),
}));

const makeConfig = (stateDir: string): Config => ({
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

const FIXTURE_FRONTMATTER = `---
title: My Test Meeting
started_at: "2026-04-26T10:00:00Z"
ended_at: "2026-04-26T10:30:00Z"
attendees:
  - Alice
  - Bob
meeting-id: mtg-001
---
This is the transcript content.
`;

describe('buildPayload', () => {
  let tmpDir: string;
  let buildPayload: typeof import('../src/watcher.js').buildPayload;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-watcher-test-'));
    const mod = await import('../src/watcher.js');
    buildPayload = mod.buildPayload;
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('extracts title/started_at/ended_at/attendees/transcript correctly from fixture frontmatter', () => {
    const config = makeConfig(tmpDir);
    const payload = buildPayload(config, '/tmp/meetily/my-meeting.md', FIXTURE_FRONTMATTER);
    expect(payload.title).toBe('My Test Meeting');
    expect(payload.started_at).toBe('2026-04-26T10:00:00.000Z');
    expect(payload.ended_at).toBe('2026-04-26T10:30:00.000Z');
    expect(payload.attendees).toEqual(['Alice', 'Bob']);
    expect(payload.transcript).toContain('This is the transcript content.');
    expect(payload.source).toBe('meetily');
    expect(payload.external_id).toBe('mtg-001');
  });

  it('falls back to filename basename when title field is missing', () => {
    const config = makeConfig(tmpDir);
    const noTitleFrontmatter = `---
started_at: "2026-04-26T10:00:00Z"
---
Some transcript.
`;
    const payload = buildPayload(config, '/tmp/meetily/2026-04-26-sprint-retro.md', noTitleFrontmatter);
    expect(payload.title).toBe('2026-04-26-sprint-retro');
  });

  it('honors explicit frontmatterFields overrides', () => {
    const config: Config = {
      ...makeConfig(tmpDir),
      frontmatterFields: {
        title: 'meeting_name',
        startedAt: 'started',
        endedAt: 'ended',
        attendees: 'participants',
        externalId: 'uid',
      },
    };
    const customFrontmatter = `---
meeting_name: Custom Meeting Name
started: "2026-04-26T09:00:00Z"
ended: "2026-04-26T09:30:00Z"
participants:
  - Carol
uid: custom-uid-001
---
Custom transcript text.
`;
    const payload = buildPayload(config, '/tmp/meetily/custom.md', customFrontmatter);
    expect(payload.title).toBe('Custom Meeting Name');
    expect(payload.attendees).toEqual(['Carol']);
    expect(payload.external_id).toBe('custom-uid-001');
  });
});

describe('processFile', () => {
  let tmpDir: string;
  let processFile: typeof import('../src/watcher.js').processFile;
  let uploadWithRetryMock: ReturnType<typeof vi.fn>;
  let markIngestedMock: ReturnType<typeof vi.fn>;
  let enqueueMock: ReturnType<typeof vi.fn>;
  let dequeueMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-watcher-process-test-'));
    vi.clearAllMocks();

    const mod = await import('../src/watcher.js');
    processFile = mod.processFile;

    const clientMod = await import('../src/client.js');
    uploadWithRetryMock = clientMod.uploadWithRetry as ReturnType<typeof vi.fn>;
    uploadWithRetryMock.mockResolvedValue({
      meeting_id: 'meet-001',
      vault_path: 'raw/meetings/test.md',
      commit_sha: 'abc123',
    });

    const markerMod = await import('../src/ingest-marker.js');
    markIngestedMock = markerMod.markIngested as ReturnType<typeof vi.fn>;

    const queueMod = await import('../src/queue.js');
    enqueueMock = queueMod.enqueue as ReturnType<typeof vi.fn>;
    dequeueMock = queueMod.dequeue as ReturnType<typeof vi.fn>;
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns immediately for non-.md extensions — MEET-07 hard filter', async () => {
    const config = makeConfig(tmpDir);
    const audioExtensions = ['.opus', '.ogg', '.wav', '.mp3', '.m4a'];

    for (const ext of audioExtensions) {
      await processFile(config, `/tmp/meetily/recording${ext}`);
    }

    expect(uploadWithRetryMock).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('skips files with empty transcript', async () => {
    const emptyTranscriptFile = path.join(tmpDir, 'empty-meeting.md');
    await fs.writeFile(emptyTranscriptFile, `---
title: Empty Meeting
started_at: "2026-04-26T10:00:00Z"
ended_at: "2026-04-26T10:30:00Z"
---
`);
    const config = makeConfig(tmpDir);
    await processFile(config, emptyTranscriptFile);
    expect(uploadWithRetryMock).not.toHaveBeenCalled();
  });

  it('calls enqueue → uploadWithRetry → dequeue → markIngested in order on success', async () => {
    const meetingFile = path.join(tmpDir, 'meeting.md');
    await fs.writeFile(meetingFile, FIXTURE_FRONTMATTER);
    const config = makeConfig(tmpDir);

    const callOrder: string[] = [];
    enqueueMock.mockImplementation(async () => { callOrder.push('enqueue'); });
    uploadWithRetryMock.mockImplementation(async () => {
      callOrder.push('uploadWithRetry');
      return { meeting_id: 'meet-001', vault_path: 'raw/meetings/test.md', commit_sha: 'abc' };
    });
    dequeueMock.mockImplementation(async () => { callOrder.push('dequeue'); });
    markIngestedMock.mockImplementation(async (p: string) => {
      callOrder.push('markIngested');
      return `${path.dirname(p)}/_ingested/${path.basename(p)}`;
    });

    await processFile(config, meetingFile);

    expect(callOrder).toEqual(['enqueue', 'uploadWithRetry', 'dequeue', 'markIngested']);
  });

  it('does NOT call markIngested when uploadWithRetry throws (item stays in queue)', async () => {
    const meetingFile = path.join(tmpDir, 'failing-meeting.md');
    await fs.writeFile(meetingFile, FIXTURE_FRONTMATTER);
    const config = makeConfig(tmpDir);

    uploadWithRetryMock.mockRejectedValue(new Error('upload failed'));

    await processFile(config, meetingFile);

    expect(enqueueMock).toHaveBeenCalled();
    expect(uploadWithRetryMock).toHaveBeenCalled();
    expect(markIngestedMock).not.toHaveBeenCalled();
    // dequeue not called — item stays queued
    expect(dequeueMock).not.toHaveBeenCalled();
  });
});
