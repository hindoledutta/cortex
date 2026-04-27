import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { NoteService } from './note.service';

describe('NoteService', () => {
  let service: NoteService;
  let prismaCreate: ReturnType<typeof vi.fn>;
  let prismaFindUnique: ReturnType<typeof vi.fn>;
  let prismaUpdate: ReturnType<typeof vi.fn>;
  let prismaFindMany: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    prismaCreate = vi.fn().mockResolvedValue({ id: 'n-new' });
    prismaFindUnique = vi
      .fn()
      .mockResolvedValue({ id: 'n-1', body: 'hello' });
    prismaUpdate = vi
      .fn()
      .mockResolvedValue({ id: 'n-1', deletedAt: new Date() });
    prismaFindMany = vi.fn().mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NoteService,
        {
          provide: PrismaService,
          useValue: {
            note: {
              create: prismaCreate,
              findUnique: prismaFindUnique,
              update: prismaUpdate,
              findMany: prismaFindMany,
            },
          },
        },
      ],
    }).compile();

    service = module.get<NoteService>(NoteService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('create() passes input straight through to prisma.note.create', async () => {
    await service.create({
      workspaceId: 'w-1',
      source: 'text',
      body: 'hello',
      slug: 'hello',
      vaultPath: 'raw/inbox/2026-04-27-hello.md',
      vaultCommitSha: 'deadbeef',
      telegramMsgId: 12345n,
    });

    expect(prismaCreate).toHaveBeenCalledWith({
      data: {
        workspaceId: 'w-1',
        source: 'text',
        body: 'hello',
        slug: 'hello',
        vaultPath: 'raw/inbox/2026-04-27-hello.md',
        vaultCommitSha: 'deadbeef',
        telegramMsgId: 12345n,
      },
    });
  });

  it('findById() looks up by id', async () => {
    const result = await service.findById('n-1');
    expect(prismaFindUnique).toHaveBeenCalledWith({
      where: { id: 'n-1' },
    });
    expect(result).toEqual({ id: 'n-1', body: 'hello' });
  });

  it('softDelete() sets deletedAt to now', async () => {
    const before = Date.now();
    await service.softDelete('n-1');
    expect(prismaUpdate).toHaveBeenCalledTimes(1);
    const args = prismaUpdate.mock.calls[0][0];
    expect(args.where).toEqual({ id: 'n-1' });
    expect(args.data.deletedAt).toBeInstanceOf(Date);
    expect(args.data.deletedAt.getTime()).toBeGreaterThanOrEqual(
      before,
    );
  });

  it('recent() filters out deleted, sorts desc, applies limit', async () => {
    await service.recent(5);
    expect(prismaFindMany).toHaveBeenCalledWith({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
  });

  it('recent() defaults limit to 10', async () => {
    await service.recent();
    expect(prismaFindMany).toHaveBeenCalledWith({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
  });
});
