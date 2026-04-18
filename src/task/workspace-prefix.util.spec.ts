import { parseWorkspacePrefix } from './workspace-prefix.util';

describe('parseWorkspacePrefix', () => {
  it('should parse @work prefix and return cleaned title', () => {
    const result = parseWorkspacePrefix('@work Buy office supplies');
    expect(result).toEqual({
      title: 'Buy office supplies',
      workspaceOverride: 'work',
    });
  });

  it('should parse @personal prefix and return cleaned title', () => {
    const result = parseWorkspacePrefix('@personal Call dentist');
    expect(result).toEqual({
      title: 'Call dentist',
      workspaceOverride: 'personal',
    });
  });

  it('should handle case-insensitive @WORK prefix', () => {
    const result = parseWorkspacePrefix('@WORK Fix printer');
    expect(result).toEqual({
      title: 'Fix printer',
      workspaceOverride: 'work',
    });
  });

  it('should handle case-insensitive @Personal prefix', () => {
    const result = parseWorkspacePrefix('@Personal Plan vacation');
    expect(result).toEqual({
      title: 'Plan vacation',
      workspaceOverride: 'personal',
    });
  });

  it('should return null workspaceOverride when no prefix', () => {
    const result = parseWorkspacePrefix('Buy groceries');
    expect(result).toEqual({
      title: 'Buy groceries',
      workspaceOverride: null,
    });
  });

  it('should trim whitespace from input and result', () => {
    const result = parseWorkspacePrefix('  @work  Trim spaces  ');
    expect(result).toEqual({
      title: 'Trim spaces',
      workspaceOverride: 'work',
    });
  });

  it('should not recognize invalid workspace prefixes', () => {
    const result = parseWorkspacePrefix('@workspace Not a valid prefix');
    expect(result).toEqual({
      title: '@workspace Not a valid prefix',
      workspaceOverride: null,
    });
  });

  it('should handle empty string', () => {
    const result = parseWorkspacePrefix('');
    expect(result).toEqual({
      title: '',
      workspaceOverride: null,
    });
  });

  it('should not match @work in the middle of text', () => {
    const result = parseWorkspacePrefix('Send email @work later');
    expect(result).toEqual({
      title: 'Send email @work later',
      workspaceOverride: null,
    });
  });

  it('should require a space after the prefix', () => {
    const result = parseWorkspacePrefix('@workFix printer');
    expect(result).toEqual({
      title: '@workFix printer',
      workspaceOverride: null,
    });
  });
});
