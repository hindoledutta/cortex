import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import slugify from 'slug';
import { LlmService } from './llm.service';
import { SlugResultSchema } from './llm.types';
import { buildSlugPrompt } from './prompts/slug.prompt';

@Injectable()
export class SlugService {
  private readonly logger = new Logger(SlugService.name);
  // Slug regex matches what we send to the LLM and what we accept after normalization.
  private static readonly SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+){2,5}$/;

  constructor(private readonly llm: LlmService) {}

  /**
   * Generate a 4-6 word kebab-case slug for `body`.
   * Falls back to a date-time-only slug if the LLM returns something unusable.
   * NEVER throws — always returns a valid slug or the fallback.
   */
  async generate(body: string): Promise<string> {
    const sample = body.slice(0, 500); // slug only needs first ~500 chars
    try {
      const response = await this.llm.createMessage(
        'slug-generation',
        buildSlugPrompt(),
        [{ role: 'user', content: sample }],
        z.toJSONSchema(SlugResultSchema) as Record<string, unknown>,
        64,
      );

      // Try the LLM's slug as-is (it should already be kebab-case).
      const raw = JSON.parse(response.content)?.slug as string | undefined;
      if (raw && SlugService.SLUG_REGEX.test(raw)) return raw;

      // Defense in depth: normalize via the slug library and re-check.
      if (raw) {
        const normalized = slugify(raw, { lower: true });
        if (SlugService.SLUG_REGEX.test(normalized)) return normalized;
      }

      this.logger.warn(`Sonnet returned unusable slug, falling back. Raw: ${raw}`);
    } catch (err) {
      this.logger.warn(`Slug generation failed (${err}), falling back to date-time slug`);
    }
    return SlugService.dateTimeFallback(new Date());
  }

  /**
   * Public for testability. Returns HHMM-note (e.g. 0932-note).
   * The date portion (YYYY-MM-DD) is prefixed by the caller when constructing the vault path.
   */
  static dateTimeFallback(now: Date): string {
    const hh = String(now.getUTCHours()).padStart(2, '0');
    const mm = String(now.getUTCMinutes()).padStart(2, '0');
    return `${hh}${mm}-note`;
  }
}
