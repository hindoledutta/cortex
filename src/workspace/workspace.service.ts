import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceName } from '../../prisma/generated/prisma/client/enums';

@Injectable()
export class WorkspaceService {
  constructor(private readonly prisma: PrismaService) {}

  async getDefault() {
    const workspace = await this.prisma.workspace.findFirst({
      where: { isDefault: true },
    });
    if (!workspace) {
      throw new NotFoundException(
        'No default workspace found. This indicates a data integrity issue.',
      );
    }
    return workspace;
  }

  async setDefault(name: WorkspaceName) {
    await this.prisma.$transaction([
      this.prisma.workspace.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      }),
      this.prisma.workspace.update({
        where: { name },
        data: { isDefault: true },
      }),
    ]);
    return this.prisma.workspace.findUnique({ where: { name } });
  }

  async findAll() {
    return this.prisma.workspace.findMany();
  }

  async findByName(name: WorkspaceName) {
    return this.prisma.workspace.findUnique({ where: { name } });
  }
}
