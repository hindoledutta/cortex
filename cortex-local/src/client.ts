import pRetry, { AbortError } from 'p-retry';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Config } from './config.js';
import type { IngestPayload, PersistedRuntimeState } from './types.js';

const RUNTIME_FILE = 'runtime.json';

export interface UploadResult {
  meeting_id: string;
  vault_path: string;
  commit_sha: string;
}

async function readRuntime(stateDir: string): Promise<PersistedRuntimeState> {
  try {
    return JSON.parse(await fs.readFile(path.join(stateDir, RUNTIME_FILE), 'utf8')) as PersistedRuntimeState;
  } catch {
    return { lastIngestAt: null, lastError: null };
  }
}

async function writeRuntime(stateDir: string, state: PersistedRuntimeState): Promise<void> {
  await fs.mkdir(stateDir, { recursive: true });
  const target = path.join(stateDir, RUNTIME_FILE);
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2));
  await fs.rename(tmp, target);
}

export async function getRuntimeState(stateDir: string): Promise<PersistedRuntimeState> {
  return readRuntime(stateDir);
}

export async function uploadWithRetry(config: Config, payload: IngestPayload): Promise<UploadResult> {
  const url = `${config.cortexApiUrl.replace(/\/$/, '')}/api/meetings/ingest`;
  try {
    const result = await pRetry<UploadResult>(
      async () => {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.sharedSecret}`,
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(60_000),
        });
        if (res.status === 401) throw new AbortError('auth failed (401) — check sharedSecret');
        if (res.status === 400) {
          const text = await res.text().catch(() => '');
          throw new AbortError(`bad payload (400): ${text.slice(0, 500)}`);
        }
        if (!res.ok) throw new Error(`status ${res.status}`);
        return (await res.json()) as UploadResult;
      },
      {
        retries: 5,
        factor: 2,
        minTimeout: 60_000,
        maxTimeout: 1_800_000,
        onFailedAttempt: (err) => {
          console.warn(
            `[upload] attempt ${err.attemptNumber} failed: ${err.message}; ${err.retriesLeft} left`,
          );
        },
      },
    );
    await writeRuntime(config.stateDir, {
      lastIngestAt: new Date().toISOString(),
      lastError: null,
    });
    return result;
  } catch (err) {
    const errMsg = String(err);
    console.error(`[upload] terminal failure: ${errMsg}`);
    const prev = await readRuntime(config.stateDir);
    await writeRuntime(config.stateDir, {
      lastIngestAt: prev.lastIngestAt,
      lastError: errMsg.slice(0, 1900), // server schema caps at 2000
    });
    throw err;
  }
}
