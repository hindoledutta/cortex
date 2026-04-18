export interface ParsedInput {
  title: string;
  workspaceOverride: 'work' | 'personal' | null;
}

export function parseWorkspacePrefix(input: string): ParsedInput {
  const trimmed = input.trim();
  const match = trimmed.match(/^@(work|personal)\s+/i);

  if (match) {
    return {
      title: trimmed.slice(match[0].length).trim(),
      workspaceOverride: match[1].toLowerCase() as 'work' | 'personal',
    };
  }

  return { title: trimmed, workspaceOverride: null };
}
