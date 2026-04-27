import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { VaultService } from './vault.service';

// ---- simple-git mock ----
// Hold the mutable mocks at module scope so each test can rebind them
// before instantiating VaultService.
type GitMethodMock = ReturnType<typeof vi.fn>;

interface GitMocks {
  fetch: GitMethodMock;
  reset: GitMethodMock;
  add: GitMethodMock;
  commit: GitMethodMock;
  push: GitMethodMock;
  pull: GitMethodMock;
  revparse: GitMethodMock;
  raw: GitMethodMock;
  addConfig: GitMethodMock;
  clone: GitMethodMock;
  env: GitMethodMock;
}

const gitMocks: GitMocks = {
  fetch: vi.fn(),
  reset: vi.fn(),
  add: vi.fn(),
  commit: vi.fn(),
  push: vi.fn(),
  pull: vi.fn(),
  revparse: vi.fn(),
  raw: vi.fn(),
  addConfig: vi.fn(),
  clone: vi.fn(),
  env: vi.fn(),
};

const callOrder: string[] = [];

function resetGitMocks() {
  callOrder.length = 0;
  for (const key of Object.keys(gitMocks) as Array<keyof GitMocks>) {
    gitMocks[key].mockReset();
    // env() returns the same mock (chainable)
    if (key === 'env') {
      gitMocks.env.mockImplementation(() => fluentGit);
    } else if (key === 'revparse') {
      gitMocks.revparse.mockImplementation(async (...args: unknown[]) => {
        callOrder.push(`revparse:${JSON.stringify(args)}`);
        return 'deadbeef\n';
      });
    } else {
      gitMocks[key].mockImplementation(async (...args: unknown[]) => {
        callOrder.push(`${String(key)}:${JSON.stringify(args)}`);
        return '';
      });
    }
  }
}

const fluentGit = new Proxy(
  {},
  {
    get(_target, prop: string) {
      if (prop in gitMocks) {
        return (gitMocks as unknown as Record<string, GitMethodMock>)[
          prop
        ];
      }
      // Any unmocked method returns chainable noop
      return () => fluentGit;
    },
  },
);

vi.mock('simple-git', () => ({
  simpleGit: vi.fn(() => fluentGit),
  SimpleGit: class {},
}));

// ---- helpers ----

async function buildService(
  vaultDir: string,
  prismaCreate: GitMethodMock,
  prismaFindFirst?: GitMethodMock,
): Promise<VaultService> {
  resetGitMocks();
  const config: Record<string, string> = {
    NIRVANA_WIKI_REPO_URL: 'git@github.com:test/test.git',
    NIRVANA_WIKI_LOCAL_DIR: vaultDir,
    NIRVANA_WIKI_SSH_KEY_PATH: '/tmp/fake-key',
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      VaultService,
      {
        provide: ConfigService,
        useValue: { get: (k: string) => config[k] },
      },
      {
        provide: PrismaService,
        useValue: {
          vaultWrite: {
            create: prismaCreate,
            findFirst:
              prismaFindFirst ?? vi.fn().mockResolvedValue(null),
          },
        },
      },
    ],
  }).compile();

  const svc = module.get<VaultService>(VaultService);
  await svc.onModuleInit();
  // Wait for bootstrap to complete (it's not awaited in onModuleInit)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (svc as any).readyPromise;
  return svc;
}

async function makeTempVault(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-test-'));
  // Create .git so bootstrap doesn't try to clone
  await fs.mkdir(path.join(dir, '.git'), { recursive: true });
  return dir;
}

// ---- tests ----

describe('VaultService', () => {
  let vaultDir: string;
  let prismaCreate: GitMethodMock;

  beforeEach(async () => {
    vaultDir = await makeTempVault();
    prismaCreate = vi.fn().mockResolvedValue({});
  });

  afterEach(async () => {
    await fs.rm(vaultDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe('assertAllowedPath (via writeFile)', () => {
    it('rejects paths not under raw/inbox/ or raw/meetings/', async () => {
      const svc = await buildService(vaultDir, prismaCreate);
      await expect(
        svc.writeFile({
          vaultPath: 'wiki/foo.md',
          body: 'x',
          commitMessage: 'm',
          kind: 'note',
          sourceId: 'n1',
        }),
      ).rejects.toThrow(/not under an allowed prefix/);
    });

    it('rejects paths containing ..', async () => {
      const svc = await buildService(vaultDir, prismaCreate);
      await expect(
        svc.writeFile({
          vaultPath: 'raw/inbox/../../../tmp/x.md',
          body: 'x',
          commitMessage: 'm',
          kind: 'note',
          sourceId: 'n1',
        }),
      ).rejects.toThrow(/contains '\.\.'/);
    });

    it('rejects ../etc/passwd', async () => {
      const svc = await buildService(vaultDir, prismaCreate);
      await expect(
        svc.writeFile({
          vaultPath: '../etc/passwd',
          body: 'x',
          commitMessage: 'm',
          kind: 'note',
          sourceId: 'n1',
        }),
      ).rejects.toThrow();
    });

    it('accepts raw/inbox/ paths', async () => {
      const svc = await buildService(vaultDir, prismaCreate);
      const result = await svc.writeFile({
        vaultPath: 'raw/inbox/foo.md',
        body: 'hello',
        commitMessage: 'add foo',
        kind: 'note',
        sourceId: 'n1',
      });
      expect(result.vaultPath).toBe('raw/inbox/foo.md');
    });

    it('accepts raw/meetings/ paths', async () => {
      const svc = await buildService(vaultDir, prismaCreate);
      const result = await svc.writeFile({
        vaultPath: 'raw/meetings/bar.md',
        body: 'hi',
        commitMessage: 'add bar',
        kind: 'meeting',
        sourceId: 'm1',
      });
      expect(result.vaultPath).toBe('raw/meetings/bar.md');
    });
  });

  describe('writeFile git operation order', () => {
    it('calls fetch -> reset -> add -> commit -> push -> revparse in order', async () => {
      const svc = await buildService(vaultDir, prismaCreate);
      await svc.writeFile({
        vaultPath: 'raw/inbox/foo.md',
        body: 'hello',
        commitMessage: 'add foo',
        kind: 'note',
        sourceId: 'n1',
      });

      const ops = callOrder.map((s) => s.split(':')[0]);
      // Drop bootstrap-time addConfig calls (they happen during onModuleInit)
      const writeOps = ops.filter((o) => o !== 'addConfig');
      expect(writeOps).toEqual([
        'fetch',
        'reset',
        'add',
        'commit',
        'push',
        'revparse',
      ]);
    });

    it('passes --author flag on commit', async () => {
      const svc = await buildService(vaultDir, prismaCreate);
      await svc.writeFile({
        vaultPath: 'raw/inbox/foo.md',
        body: 'hello',
        commitMessage: 'add foo',
        kind: 'note',
        sourceId: 'n1',
      });

      expect(gitMocks.commit).toHaveBeenCalledWith(
        'add foo',
        undefined,
        { '--author': 'cortex-bot <bot@cortex.local>' },
      );
    });

    it('passes --hard origin/main to reset', async () => {
      const svc = await buildService(vaultDir, prismaCreate);
      await svc.writeFile({
        vaultPath: 'raw/inbox/foo.md',
        body: 'hello',
        commitMessage: 'add foo',
        kind: 'note',
        sourceId: 'n1',
      });

      expect(gitMocks.reset).toHaveBeenCalledWith([
        '--hard',
        'origin/main',
      ]);
    });
  });

  describe('audit log', () => {
    it('inserts ONE VaultWrite row with succeeded=true on success', async () => {
      const svc = await buildService(vaultDir, prismaCreate);
      await svc.writeFile({
        vaultPath: 'raw/inbox/foo.md',
        body: 'hello',
        commitMessage: 'add foo',
        kind: 'note',
        sourceId: 'n1',
      });

      expect(prismaCreate).toHaveBeenCalledTimes(1);
      const row = prismaCreate.mock.calls[0][0].data;
      expect(row.succeeded).toBe(true);
      expect(row.error).toBeNull();
      expect(row.kind).toBe('note');
      expect(row.sourceId).toBe('n1');
      expect(row.vaultPath).toBe('raw/inbox/foo.md');
      expect(row.commitSha).toBe('deadbeef');
    });

    it('inserts ONE VaultWrite row with succeeded=false on push failure', async () => {
      const svc = await buildService(vaultDir, prismaCreate);
      // Both push attempts fail
      gitMocks.push.mockRejectedValueOnce(new Error('first push fail'));
      gitMocks.push.mockRejectedValueOnce(new Error('second push fail'));

      await expect(
        svc.writeFile({
          vaultPath: 'raw/inbox/foo.md',
          body: 'hello',
          commitMessage: 'add foo',
          kind: 'note',
          sourceId: 'n1',
        }),
      ).rejects.toThrow(/second push fail/);

      expect(prismaCreate).toHaveBeenCalledTimes(1);
      const row = prismaCreate.mock.calls[0][0].data;
      expect(row.succeeded).toBe(false);
      expect(row.error).toMatch(/second push fail/);
    });

    it('does NOT insert audit row if assertAllowedPath throws (fail-fast before mutex)', async () => {
      const svc = await buildService(vaultDir, prismaCreate);
      await expect(
        svc.writeFile({
          vaultPath: 'wiki/x.md',
          body: 'x',
          commitMessage: 'm',
          kind: 'note',
          sourceId: 'n1',
        }),
      ).rejects.toThrow();
      // assertAllowedPath runs BEFORE the try/finally — no audit row
      // is emitted for path-prefix violations (defense-in-depth: bad
      // input shouldn't pollute the audit table).
      expect(prismaCreate).not.toHaveBeenCalled();
    });
  });

  describe('mutex serialization', () => {
    it('serializes two concurrent writeFile calls — second push happens after first push resolves', async () => {
      const svc = await buildService(vaultDir, prismaCreate);

      // Make push wait for an external trigger so we can interleave.
      let resolveFirstPush!: () => void;
      const firstPushGate = new Promise<void>((r) => {
        resolveFirstPush = r;
      });
      const pushTimestamps: number[] = [];

      gitMocks.push.mockImplementationOnce(async () => {
        pushTimestamps.push(Date.now());
        await firstPushGate;
      });
      gitMocks.push.mockImplementationOnce(async () => {
        pushTimestamps.push(Date.now());
      });

      const p1 = svc.writeFile({
        vaultPath: 'raw/inbox/a.md',
        body: 'a',
        commitMessage: 'a',
        kind: 'note',
        sourceId: 'n1',
      });
      const p2 = svc.writeFile({
        vaultPath: 'raw/inbox/b.md',
        body: 'b',
        commitMessage: 'b',
        kind: 'note',
        sourceId: 'n2',
      });

      // Yield so p2 has a chance to enter the mutex queue
      await new Promise((r) => setTimeout(r, 20));
      // Only the first push should have started
      expect(pushTimestamps).toHaveLength(1);

      resolveFirstPush();
      await Promise.all([p1, p2]);

      expect(pushTimestamps).toHaveLength(2);
      expect(pushTimestamps[1]).toBeGreaterThanOrEqual(
        pushTimestamps[0],
      );
      // Two audit rows
      expect(prismaCreate).toHaveBeenCalledTimes(2);
    });
  });
});
