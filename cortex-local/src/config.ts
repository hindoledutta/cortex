import * as fs from 'node:fs/promises';
import { z } from 'zod';

export const ConfigSchema = z.object({
  cortexApiUrl: z.string().url(),
  sharedSecret: z.string().min(32),
  meetilyOutputDir: z.string().min(1),
  host: z.string().min(1).max(100),
  stateDir: z.string().min(1),
  frontmatterFields: z
    .object({
      title: z.string().default('title'),
      startedAt: z.string().default('started_at'),
      endedAt: z.string().default('ended_at'),
      attendees: z.string().default('attendees'),
      externalId: z.string().default('meeting-id'),
    })
    .default({
      title: 'title',
      startedAt: 'started_at',
      endedAt: 'ended_at',
      attendees: 'attendees',
      externalId: 'meeting-id',
    }),
  heartbeatCron: z.string().default('0 9 * * *'),
});

export type Config = z.infer<typeof ConfigSchema>;

export async function loadConfig(configPath?: string): Promise<Config> {
  const resolvedPath = configPath ?? process.env['CORTEX_LOCAL_CONFIG'];
  if (!resolvedPath) {
    throw new Error(
      'Config path not provided. Set CORTEX_LOCAL_CONFIG environment variable or pass a path to loadConfig().',
    );
  }

  let raw: string;
  try {
    raw = await fs.readFile(resolvedPath, 'utf8');
  } catch (err) {
    throw new Error(`Cannot read config file at "${resolvedPath}": ${String(err)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Config file at "${resolvedPath}" is not valid JSON: ${String(err)}`);
  }

  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Config validation failed:\n${issues}`);
  }

  return result.data;
}
