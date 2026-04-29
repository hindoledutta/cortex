import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { markIngested } from '../src/ingest-marker.js';

describe('markIngested', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-ingest-marker-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('moves file to <dir>/_ingested/<basename> and returns destination path', async () => {
    const srcFile = path.join(tmpDir, 'meeting.md');
    await fs.writeFile(srcFile, 'contents');

    const dst = await markIngested(srcFile);

    expect(dst).toBe(path.join(tmpDir, '_ingested', 'meeting.md'));
    // Source gone
    await expect(fs.access(srcFile)).rejects.toThrow();
    // Destination exists with correct content
    const content = await fs.readFile(dst, 'utf8');
    expect(content).toBe('contents');
  });

  it('creates _ingested/ dir if missing', async () => {
    const srcFile = path.join(tmpDir, 'new-meeting.md');
    await fs.writeFile(srcFile, 'transcript');

    // Ensure _ingested/ does not pre-exist
    const ingestedDir = path.join(tmpDir, '_ingested');
    await expect(fs.access(ingestedDir)).rejects.toThrow();

    await markIngested(srcFile);

    const stat = await fs.stat(ingestedDir);
    expect(stat.isDirectory()).toBe(true);
  });

  it('Deterministic overwrite behavior: calling markIngested twice with same basename overwrites the previous file', async () => {
    // Deterministic by spec: macOS fs.rename overwrites destination atomically — see Node.js fs.promises.rename docs and POSIX rename(2).
    // If we ever need to preserve old ingested copies, switch to a content-hashed filename here.

    // Write fixture A and mark it ingested
    const fixtureA = path.join(tmpDir, 'meeting.md');
    await fs.writeFile(fixtureA, 'contents of A');
    await markIngested(fixtureA);

    // The _ingested/meeting.md should now contain A's contents
    const ingestedPath = path.join(tmpDir, '_ingested', 'meeting.md');
    const afterFirstIngest = await fs.readFile(ingestedPath, 'utf8');
    expect(afterFirstIngest).toBe('contents of A');

    // Write fixture B with the same filename to the watch dir
    const fixtureB = path.join(tmpDir, 'meeting.md');
    await fs.writeFile(fixtureB, 'contents of B');
    await markIngested(fixtureB);

    // _ingested/meeting.md should now contain B's contents (overwritten, no error thrown)
    const afterSecondIngest = await fs.readFile(ingestedPath, 'utf8');
    expect(afterSecondIngest).toBe('contents of B');
  });
});
