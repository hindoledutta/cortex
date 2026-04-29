import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const INGESTED_DIR = '_ingested';

export async function markIngested(filePath: string): Promise<string> {
  const dir = path.dirname(filePath);
  const ingestedDir = path.join(dir, INGESTED_DIR);
  await fs.mkdir(ingestedDir, { recursive: true });
  const dst = path.join(ingestedDir, path.basename(filePath));
  await fs.rename(filePath, dst);
  return dst;
}
