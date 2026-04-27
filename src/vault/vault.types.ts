/**
 * Public types for VaultService — the only git-write primitive in Cortex.
 * Consumers (NoteModule, future MeetingsModule) build these inputs and
 * receive a commit SHA + the post-collision-resolution path back.
 */

export type VaultEntityKind = 'note' | 'meeting';

export interface WriteFileInput {
  /** Vault-relative path. MUST start with raw/inbox/ or raw/meetings/. */
  vaultPath: string;
  /** Verbatim file body. Written exactly as-is, UTF-8. */
  body: string;
  /** Commit message body. Author is hard-coded to cortex-bot. */
  commitMessage: string;
  /** Audit-log discriminator. */
  kind: VaultEntityKind;
  /** Audit-log foreign key (Note.id or Meeting.id). No DB FK enforced. */
  sourceId: string;
}

export interface WriteFileResult {
  /** Full SHA of the commit pushed to origin/main. */
  commitSha: string;
  /** Final vault-relative path (may differ from requested if collision-resolved). */
  vaultPath: string;
}

export interface RevertResult {
  /** SHA of the new revert commit on origin/main. */
  commitSha: string;
}
