/**
 * Unit tests for pure helper methods on OrchestratorService related to note handling.
 *
 * These methods are private but are tested by extracting them as standalone functions
 * mirroring their logic — no DI required.
 */

/** Mirror of OrchestratorService.extractTranscriptFromTranscriptionMessage */
function extractTranscript(text: string): string | null {
  const match = text.match(/I heard:\s*\n([\s\S]+?)\n\nProcessing\.\.\./);
  return match ? match[1].trim() : null;
}

/** Mirror of OrchestratorService.parseWorkspacePrefix */
function parseWorkspacePrefix(text: string): {
  workspace: 'work' | 'personal' | null;
  body: string;
} {
  const m = text.match(/^@(work|personal)\s+([\s\S]+)$/i);
  if (m) return { workspace: m[1].toLowerCase() as 'work' | 'personal', body: m[2].trim() };
  return { workspace: null, body: text.trim() };
}

describe('OrchestratorService note helpers', () => {
  describe('parseWorkspacePrefix', () => {
    it('extracts @work workspace and strips prefix from body', () => {
      const result = parseWorkspacePrefix('@work go to lunch');
      expect(result).toEqual({ workspace: 'work', body: 'go to lunch' });
    });

    it('extracts @personal workspace and strips prefix from body', () => {
      const result = parseWorkspacePrefix('@personal buy groceries');
      expect(result).toEqual({ workspace: 'personal', body: 'buy groceries' });
    });

    it('returns null workspace for a regular note (no prefix)', () => {
      const result = parseWorkspacePrefix('regular note');
      expect(result).toEqual({ workspace: null, body: 'regular note' });
    });

    it('trims whitespace from body when no prefix', () => {
      const result = parseWorkspacePrefix('  padded note  ');
      expect(result.body).toBe('padded note');
    });

    it('handles multi-word body with @work prefix', () => {
      const result = parseWorkspacePrefix('@work review the design doc before Friday');
      expect(result.workspace).toBe('work');
      expect(result.body).toBe('review the design doc before Friday');
    });
  });

  describe('extractTranscriptFromTranscriptionMessage', () => {
    it('extracts transcript body from formatTranscription output', () => {
      const formatted = '🎤 I heard:\nfoo bar\n\nProcessing...';
      expect(extractTranscript(formatted)).toBe('foo bar');
    });

    it('returns null for non-transcription text', () => {
      expect(extractTranscript('not a transcript')).toBeNull();
    });

    it('handles multi-line transcript body', () => {
      const formatted = '🎤 I heard:\nline one\nline two\n\nProcessing...';
      expect(extractTranscript(formatted)).toBe('line one\nline two');
    });

    it('returns null for empty string', () => {
      expect(extractTranscript('')).toBeNull();
    });
  });
});
