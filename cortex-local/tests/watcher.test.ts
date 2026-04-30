import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Config } from '../src/config.js';

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
  heartbeatCron: '0 9 * * *',
});

const FIXTURE_METADATA = {
  meeting_id: 'meeting-abc123',
  meeting_name: 'Sprint Planning Q2',
  created_at: '2026-04-30T10:00:00.000Z',
  completed_at: '2026-04-30T11:00:00.000Z',
  status: 'completed',
};

const FIXTURE_TRANSCRIPTS = {
  segments: [
    { sequence_id: 0, audio_start_time: 4.56, text: 'Hello, let us start the meeting.' },
    { sequence_id: 2, audio_start_time: 10.1, text: 'Out-of-order segment.' },
    { sequence_id: 1, audio_start_time: 65.2, text: 'Great, agenda item one.' },
  ],
};

describe('buildPayload', () => {
  let buildPayload: typeof import('../src/watcher.js').buildPayload;

  beforeEach(async () => {
    const mod = await import('../src/watcher.js');
    buildPayload = mod.buildPayload;
  });

  it('maps Meetily JSON to IngestPayload with correct fields', () => {
    const payload = buildPayload(
      '/tmp/meetily/Sprint_Planning_Q2_2026-04-30',
      FIXTURE_METADATA,
      FIXTURE_TRANSCRIPTS,
    );
    expect(payload.title).toBe('Sprint Planning Q2');
    expect(payload.started_at).toBe('2026-04-30T10:00:00.000Z');
    expect(payload.ended_at).toBe('2026-04-30T11:00:00.000Z');
    expect(payload.attendees).toEqual([]);
    expect(payload.source).toBe('meetily');
    expect(payload.external_id).toBe('meeting-abc123');
  });

  it('sorts segments by sequence_id before building transcript', () => {
    const payload = buildPayload('/tmp/meetily/test', FIXTURE_METADATA, FIXTURE_TRANSCRIPTS);
    const lines = payload.transcript.split('\n');
    // Fixture: seq_id {0, 2, 1} → sorted order: 0, 1, 2
    expect(lines[0]).toContain('Hello, let us start the meeting.'); // seq_id 0
    expect(lines[1]).toContain('Great, agenda item one.'); // seq_id 1
    expect(lines[2]).toContain('Out-of-order segment.'); // seq_id 2
  });

  it('formats timestamps as [M:SS]', () => {
    const transcripts = {
      segments: [
        { sequence_id: 0, audio_start_time: 65.2, text: 'At one minute.' },
        { sequence_id: 1, audio_start_time: 3661.0, text: 'At sixty-one minutes.' },
      ],
    };
    const payload = buildPayload('/tmp/meetily/test', FIXTURE_METADATA, transcripts);
    const lines = payload.transcript.split('\n');
    expect(lines[0]).toMatch(/^\[1:05\]/);
    expect(lines[1]).toMatch(/^\[61:01\]/);
  });

  it('falls back to folder basename when meeting_name is empty', () => {
    const meta = { ...FIXTURE_METADATA, meeting_name: '' };
    const payload = buildPayload('/tmp/meetily/My_Meeting_Folder', meta, {
      segments: [{ sequence_id: 0, audio_start_time: 0, text: 'Hi.' }],
    });
    expect(payload.title).toBe('My_Meeting_Folder');
  });

  it('uses created_at as ended_at when completed_at is null', () => {
    const meta = { ...FIXTURE_METADATA, completed_at: null };
    const payload = buildPayload('/tmp/meetily/test', meta, {
      segments: [{ sequence_id: 0, audio_start_time: 0, text: 'Hi.' }],
    });
    expect(payload.ended_at).toBe(payload.started_at);
  });

  it('sets external_id to undefined when meeting_id is null', () => {
    const meta = { ...FIXTURE_METADATA, meeting_id: null };
    const payload = buildPayload('/tmp/meetily/test', meta, {
      segments: [{ sequence_id: 0, audio_start_time: 0, text: 'Hi.' }],
    });
    expect(payload.external_id).toBeUndefined();
  });
});

describe('processFolder', () => {
  let tmpDir: string;
  let processFolder: typeof import('../src/watcher.js').processFolder;
  let uploadWithRetryMock: ReturnType<typeof vi.fn>;
  let enqueueMock: ReturnType<typeof vi.fn>;
  let dequeueMock: ReturnType<typeof vi.fn>;

  const writeMeetingFolder = async (dir: string, meta: object, transcripts: object) => {
    await fs.writeFile(path.join(dir, 'metadata.json'), JSON.stringify(meta));
    await fs.writeFile(path.join(dir, 'transcripts.json'), JSON.stringify(transcripts));
  };

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-watcher-test-'));
    vi.clearAllMocks();
    const mod = await import('../src/watcher.js');
    processFolder = mod.processFolder;
    const clientMod = await import('../src/client.js');
    uploadWithRetryMock = clientMod.uploadWithRetry as ReturnType<typeof vi.fn>;
    uploadWithRetryMock.mockResolvedValue({
      meeting_id: 'meet-001',
      vault_path: 'raw/meetings/test.md',
      commit_sha: 'abc123',
    });
    const queueMod = await import('../src/queue.js');
    enqueueMock = queueMod.enqueue as ReturnType<typeof vi.fn>;
    dequeueMock = queueMod.dequeue as ReturnType<typeof vi.fn>;
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('skips folder that already has .ingested marker', async () => {
    await writeMeetingFolder(tmpDir, FIXTURE_METADATA, FIXTURE_TRANSCRIPTS);
    await fs.writeFile(path.join(tmpDir, '.ingested'), '2026-04-30T10:00:00Z');
    await processFolder(makeConfig(tmpDir), tmpDir);
    expect(uploadWithRetryMock).not.toHaveBeenCalled();
  });

  it('skips folder where metadata status is not completed', async () => {
    await writeMeetingFolder(tmpDir, { ...FIXTURE_METADATA, status: 'recording' }, FIXTURE_TRANSCRIPTS);
    await processFolder(makeConfig(tmpDir), tmpDir);
    expect(uploadWithRetryMock).not.toHaveBeenCalled();
  });

  it('skips folder with empty transcript segments', async () => {
    await writeMeetingFolder(tmpDir, FIXTURE_METADATA, { segments: [] });
    await processFolder(makeConfig(tmpDir), tmpDir);
    expect(uploadWithRetryMock).not.toHaveBeenCalled();
  });

  it('calls enqueue → upload → dequeue → writes .ingested on success', async () => {
    await writeMeetingFolder(tmpDir, FIXTURE_METADATA, FIXTURE_TRANSCRIPTS);
    const callOrder: string[] = [];
    enqueueMock.mockImplementation(async () => { callOrder.push('enqueue'); });
    uploadWithRetryMock.mockImplementation(async () => {
      callOrder.push('upload');
      return { meeting_id: 'meet-001', vault_path: 'x', commit_sha: 'y' };
    });
    dequeueMock.mockImplementation(async () => { callOrder.push('dequeue'); });

    await processFolder(makeConfig(tmpDir), tmpDir);

    expect(callOrder).toEqual(['enqueue', 'upload', 'dequeue']);
    const marker = await fs.readFile(path.join(tmpDir, '.ingested'), 'utf8');
    expect(marker).toBeTruthy();
  });

  it('does not write .ingested when upload fails (item stays queued)', async () => {
    await writeMeetingFolder(tmpDir, FIXTURE_METADATA, FIXTURE_TRANSCRIPTS);
    uploadWithRetryMock.mockRejectedValue(new Error('upload failed'));

    await processFolder(makeConfig(tmpDir), tmpDir);

    expect(enqueueMock).toHaveBeenCalled();
    await expect(fs.access(path.join(tmpDir, '.ingested'))).rejects.toThrow();
    expect(dequeueMock).not.toHaveBeenCalled();
  });
});

describe('processMetadataFile', () => {
  let tmpDir: string;
  let processMetadataFile: typeof import('../src/watcher.js').processMetadataFile;
  let uploadWithRetryMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-meta-test-'));
    vi.clearAllMocks();
    const mod = await import('../src/watcher.js');
    processMetadataFile = mod.processMetadataFile;
    const clientMod = await import('../src/client.js');
    uploadWithRetryMock = clientMod.uploadWithRetry as ReturnType<typeof vi.fn>;
    uploadWithRetryMock.mockResolvedValue({ meeting_id: 'x', vault_path: 'y', commit_sha: 'z' });
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('ignores non-metadata.json files — MEET-07 audio/other filter', async () => {
    const config = makeConfig(tmpDir);
    for (const name of ['audio.m4a', 'audio.mp4', 'transcripts.json', 'notes.txt']) {
      await processMetadataFile(config, path.join(tmpDir, name));
    }
    expect(uploadWithRetryMock).not.toHaveBeenCalled();
  });
});
