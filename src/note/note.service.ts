import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NoteSource } from '../../prisma/generated/prisma/client/enums';

export interface CreateNoteInput {
  workspaceId: string;
  source: NoteSource;
  body: string;
  slug: string;
  vaultPath: string;
  vaultCommitSha: string;
  telegramMsgId?: bigint | null;
}

/**
 * Thin domain service over the Note model. Intentionally has no awareness
 * of the vault — callers (TelegramModule via the orchestrator in plan
 * 07a-02) are responsible for invoking VaultService.writeFile() and
 * passing the resulting commitSha + finalPath in here.
 */
@Injectable()
export class NoteService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateNoteInput) {
    return this.prisma.note.create({ data: { ...input } });
  }

  async findById(id: string) {
    return this.prisma.note.findUnique({ where: { id } });
  }

  async softDelete(id: string) {
    return this.prisma.note.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /** Last N undeleted notes across all workspaces, newest first. */
  async recent(limit = 10) {
    return this.prisma.note.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
