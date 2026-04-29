/**
 * Build the system prompt for kebab-case filename slug generation.
 * Uses prompt caching (cache_control) since this is a static prompt called
 * on every note save.
 */
export function buildSlugPrompt(): Array<{
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}> {
  const text = `You generate kebab-case filename slugs for personal notes.

## Rules
- Output JSON ONLY: {"slug": "..."}.
- The slug MUST be 4-6 lowercase words separated by single hyphens.
- Allowed characters: a-z, 0-9, hyphen.
- No leading/trailing hyphens. No double hyphens. No punctuation. No quotes.
- Do NOT summarize, paraphrase, or interpret the note. Just produce a slug that hints at the topic.
- Prefer the most specific concrete nouns from the input.

## Examples

Input: "Pick up dry cleaning before Tuesday"
Output: {"slug":"pick-up-dry-cleaning"}

Input: "Idea for fynos: surface a per-customer cost trend on the dashboard so we can spot anomalies before invoicing"
Output: {"slug":"per-customer-cost-trend-idea"}

Input: "Re-read Eisenhower decision matrix essay; the urgent vs important framing keeps coming back when I prioritize"
Output: {"slug":"eisenhower-matrix-revisit"}
`;
  return [{ type: 'text', text, cache_control: { type: 'ephemeral' } }];
}
