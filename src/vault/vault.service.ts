import {
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Mutex } from 'async-mutex';
import { promises as fs } from 'fs';
import * as path from 'path';
import { simpleGit, SimpleGit } from 'simple-git';
import { PrismaService } from '../prisma/prisma.service';
import {
  RevertResult,
  VaultEntityKind,
  WriteFileInput,
  WriteFileResult,
} from './vault.types';

/**
 * VaultService is the SINGLE serialization point for every git write to the
 * nirvana-wiki working clone on the Fly persistent volume.
 *
 * Contract for downstream callers:
 *   1. writeFile() / revertLastCommit() are the only public mutating APIs.
 *   2. Both methods are mutex-serialized — concurrent calls execute strictly
 *      one at a time, never producing a dirty index or interleaved git ops.
 *   3. Writes outside ALLOWED_PREFIXES throw SYNCHRONOUSLY before any disk
 *      or git side-effects occur and BEFORE the mutex is acquired.
 *   4. Every call (success or failure) appends exactly one VaultWrite audit row.
 *   5. Push retries once after fetch+rebase on conflict; second failure
 *      surfaces the error (and is recorded in the audit row).
 *   6. The mutex MUST NOT be held across LLM calls or other long async
 *      operations — only across the short fetch -> reset -> write -> commit
 *      -> push sequence.
 */
@Injectable()
export class VaultService implements OnModuleInit {
  private readonly logger = new Logger(VaultService.name);
  private readonly mutex = new Mutex();
  private git!: SimpleGit;
  private vaultDir!: string;
  private readyPromise!: Promise<void>;

  private static readonly ALLOWED_PREFIXES = [
    'raw/inbox/',
    'raw/meetings/',
  ];
  private static readonly AUTHOR = 'cortex-bot <bot@cortex.local>';
  private static readonly USER_NAME = 'cortex-bot';
  private static readonly USER_EMAIL = 'bot@cortex.local';

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.readyPromise = this.bootstrap();
    // Don't await here — let modules finish init in parallel. Public methods
    // await readyPromise themselves, defending against startup races.
    this.readyPromise.catch((err) => {
      this.logger.error(`Vault bootstrap failed: ${err}`);
    });
  }

  // ---------- bootstrap ----------

  private async bootstrap(): Promise<void> {
    const repoUrl = this.requireEnv('NIRVANA_WIKI_REPO_URL');
    const sshKeyPath = this.requireEnv('NIRVANA_WIKI_SSH_KEY_PATH');
    this.vaultDir = this.requireEnv('NIRVANA_WIKI_LOCAL_DIR');

    const sshCommand = `ssh -i ${sshKeyPath} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`;

    const gitDir = path.join(this.vaultDir, '.git');
    let needsClone = false;
    try {
      await fs.access(gitDir);
    } catch {
      needsClone = true;
    }

    if (needsClone) {
      this.logger.log(`Bootstrapping clone to ${this.vaultDir}`);
      await fs.mkdir(path.dirname(this.vaultDir), { recursive: true });
      await simpleGit({ unsafe: { allowUnsafeSshCommand: true } })
        .env('GIT_SSH_COMMAND', sshCommand)
        .clone(repoUrl, this.vaultDir);
    }

    this.git = simpleGit(this.vaultDir, { unsafe: { allowUnsafeSshCommand: true } }).env(
      'GIT_SSH_COMMAND',
      sshCommand,
    );

    // Belt-and-suspenders. The --author flag on each commit is still
    // authoritative, but this keeps `git log` clean if anyone shells in.
    await this.git.addConfig('user.email', VaultService.USER_EMAIL);
    await this.git.addConfig('user.name', VaultService.USER_NAME);

    this.logger.log(`Vault ready at ${this.vaultDir}`);
  }

  private requireEnv(key: string): string {
    const value = this.config.get<string>(key);
    if (!value) {
      throw new Error(`VaultService: required env ${key} is missing`);
    }
    return value;
  }

  // ---------- public API ----------

  async writeFile(input: WriteFileInput): Promise<WriteFileResult> {
    await this.readyPromise;

    // Path-prefix guard runs BEFORE the mutex so a misuse can't
    // wedge concurrent writers. Throws synchronously by design.
    this.assertAllowedPath(input.vaultPath);

    let commitSha: string | null = null;
    let finalPath: string = input.vaultPath;
    let errorMsg: string | null = null;

    try {
      await this.mutex.runExclusive(async () => {
        // Step 1: fetch + hard reset to origin/main (cheap, idempotent).
        await this.git.fetch();
        await this.git.reset(['--hard', 'origin/main']);

        // Step 2: resolve filename collision (-2, -3, ...) on disk.
        finalPath = await this.resolveCollision(input.vaultPath);
        const absPath = path.join(this.vaultDir, finalPath);

        // Step 3: write the file.
        await fs.mkdir(path.dirname(absPath), { recursive: true });
        await fs.writeFile(absPath, input.body, 'utf8');

        // Step 4: stage + commit with hard-coded author.
        await this.git.add(finalPath);
        await this.git.commit(input.commitMessage, undefined, {
          '--author': VaultService.AUTHOR,
        });

        // Step 5: push, with one retry after fetch+rebase.
        try {
          await this.git.push('origin', 'main');
        } catch (err) {
          this.logger.warn(
            `Push failed, retrying after rebase: ${err}`,
          );
          await this.git.fetch();
          await this.git.pull('origin', 'main', { '--rebase': null });
          await this.git.push('origin', 'main');
        }

        commitSha = (await this.git.revparse(['HEAD'])).trim();
      });
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      // Audit log ALWAYS — the try/finally guarantees one row per call.
      await this.prisma.vaultWrite.create({
        data: {
          kind: input.kind,
          sourceId: input.sourceId,
          vaultPath: finalPath,
          commitSha,
          succeeded: errorMsg === null,
          error: errorMsg,
        },
      });
    }

    return { commitSha: commitSha!, vaultPath: finalPath };
  }

  async revertLastCommit(expectedSha: string): Promise<RevertResult> {
    await this.readyPromise;

    let revertSha: string | null = null;
    let errorMsg: string | null = null;
    // We need kind/sourceId for the audit row. Look up the most recent
    // VaultWrite for this commit SHA — it's the only authoritative source.
    const original = await this.prisma.vaultWrite.findFirst({
      where: { commitSha: expectedSha, succeeded: true },
      orderBy: { createdAt: 'desc' },
    });
    const auditKind: VaultEntityKind = (original?.kind ??
      'note') as VaultEntityKind;
    const auditSourceId = original?.sourceId ?? expectedSha;
    const auditPath = original?.vaultPath ?? '';

    try {
      await this.mutex.runExclusive(async () => {
        await this.git.fetch();
        await this.git.reset(['--hard', 'origin/main']);

        const head = (await this.git.revparse(['HEAD'])).trim();
        if (head !== expectedSha) {
          throw new Error(
            `HEAD is ${head}, expected ${expectedSha} — vault has moved on, cannot undo`,
          );
        }

        await this.git.raw([
          'revert',
          'HEAD',
          '--no-edit',
        ]);
        await this.git.push('origin', 'main');

        revertSha = (await this.git.revparse(['HEAD'])).trim();
      });
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      await this.prisma.vaultWrite.create({
        data: {
          kind: auditKind,
          sourceId: auditSourceId,
          vaultPath: auditPath,
          commitSha: revertSha,
          succeeded: errorMsg === null,
          error: errorMsg
            ? `revert: ${errorMsg}`
            : `revert: ${expectedSha}`,
        },
      });
    }

    return { commitSha: revertSha! };
  }

  // ---------- internals ----------

  /** Throws synchronously if `p` is not under raw/inbox/ or raw/meetings/. */
  private assertAllowedPath(p: string): void {
    if (p.includes('..')) {
      throw new Error(
        `VaultService: path '${p}' contains '..' — refusing to write`,
      );
    }
    if (
      !VaultService.ALLOWED_PREFIXES.some((prefix) =>
        p.startsWith(prefix),
      )
    ) {
      throw new Error(
        `VaultService: path '${p}' is not under an allowed prefix (${VaultService.ALLOWED_PREFIXES.join(
          ', ',
        )})`,
      );
    }
  }

  /**
   * If `desired` exists, append -2, -3, ... before the extension until a
   * free path is found. Returns the chosen vault-relative path.
   */
  private async resolveCollision(desired: string): Promise<string> {
    const ext = path.extname(desired);
    const stem = desired.slice(0, desired.length - ext.length);
    let candidate = desired;
    let suffix = 2;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const abs = path.join(this.vaultDir, candidate);
      try {
        await fs.access(abs);
      } catch {
        return candidate;
      }
      candidate = `${stem}-${suffix}${ext}`;
      suffix += 1;
      if (suffix > 1000) {
        throw new Error(
          `VaultService: too many collisions for ${desired}`,
        );
      }
    }
  }
}
