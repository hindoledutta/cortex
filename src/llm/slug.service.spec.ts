import { Test, TestingModule } from '@nestjs/testing';
import { SlugService } from './slug.service';
import { LlmService } from './llm.service';

describe('SlugService', () => {
  let service: SlugService;
  let mockCreateMessage: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    mockCreateMessage = vi.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SlugService,
        {
          provide: LlmService,
          useValue: { createMessage: mockCreateMessage },
        },
      ],
    }).compile();

    service = module.get<SlugService>(SlugService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns valid slug as-is when LLM returns a clean kebab-case slug', async () => {
    mockCreateMessage.mockResolvedValue({
      content: JSON.stringify({ slug: 'pick-up-dry-cleaning' }),
      usage: { input_tokens: 50, output_tokens: 10 },
    });

    const result = await service.generate('Pick up dry cleaning before Tuesday');
    expect(result).toBe('pick-up-dry-cleaning');
  });

  it('normalizes a slug with extra chars via slug library and returns clean slug', async () => {
    // Slug with uppercase and spaces that the slug library can clean up to match regex
    mockCreateMessage.mockResolvedValue({
      content: JSON.stringify({ slug: 'Per Customer Cost Trend Idea' }),
      usage: { input_tokens: 60, output_tokens: 10 },
    });

    const result = await service.generate('customer cost trend idea for fynos');
    // slug library will convert spaces/caps to kebab — result must match SLUG_REGEX
    expect(result).toMatch(/^[a-z0-9]+(-[a-z0-9]+){2,5}$/);
  });

  it('falls back to HHMM-note when LLM returns a single-word slug', async () => {
    mockCreateMessage.mockResolvedValue({
      content: JSON.stringify({ slug: 'idea' }),
      usage: { input_tokens: 40, output_tokens: 5 },
    });

    const result = await service.generate('just an idea');
    expect(result).toMatch(/^\d{4}-note$/);
  });

  it('falls back to HHMM-note when LLM returns junk slug with dashes', async () => {
    mockCreateMessage.mockResolvedValue({
      content: JSON.stringify({ slug: '---' }),
      usage: { input_tokens: 40, output_tokens: 5 },
    });

    const result = await service.generate('random thought');
    expect(result).toMatch(/^\d{4}-note$/);
  });

  it('falls back to HHMM-note when LLM returns empty slug', async () => {
    mockCreateMessage.mockResolvedValue({
      content: JSON.stringify({ slug: '' }),
      usage: { input_tokens: 40, output_tokens: 5 },
    });

    const result = await service.generate('something');
    expect(result).toMatch(/^\d{4}-note$/);
  });

  it('falls back to HHMM-note when LlmService.createMessage throws (does NOT propagate error)', async () => {
    mockCreateMessage.mockRejectedValue(new Error('Network error'));

    const result = await service.generate('some note body');
    expect(result).toMatch(/^\d{4}-note$/);
  });

  it('calls LlmService with slug-generation operation, maxTokens=64, and cache-controlled prompt array', async () => {
    mockCreateMessage.mockResolvedValue({
      content: JSON.stringify({ slug: 'eisenhower-matrix-revisit-note' }),
      usage: { input_tokens: 70, output_tokens: 10 },
    });

    await service.generate('Re-read Eisenhower matrix essay');

    expect(mockCreateMessage).toHaveBeenCalledWith(
      'slug-generation',
      expect.any(Array),
      expect.any(Array),
      expect.any(Object),
      64,
    );

    // System prompt must be in cache-controlled array format
    const systemPrompt = mockCreateMessage.mock.calls[0][1];
    expect(Array.isArray(systemPrompt)).toBe(true);
    expect(systemPrompt[0]).toHaveProperty('cache_control');
    expect(systemPrompt[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('dateTimeFallback returns HHMM-note string from a known time', () => {
    const testDate = new Date('2026-04-29T09:32:00Z');
    expect(SlugService.dateTimeFallback(testDate)).toBe('0932-note');
  });

  it('only sends first 500 chars of body to LLM', async () => {
    mockCreateMessage.mockResolvedValue({
      content: JSON.stringify({ slug: 'short-body-slug-test' }),
      usage: { input_tokens: 60, output_tokens: 10 },
    });

    const longBody = 'a'.repeat(1000);
    await service.generate(longBody);

    const messages = mockCreateMessage.mock.calls[0][2];
    expect(messages[0].content.length).toBeLessThanOrEqual(500);
  });
});
