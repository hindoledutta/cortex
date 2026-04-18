import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { WorkspaceService } from './workspace.service';
import { PrismaService } from '../prisma/prisma.service';

describe('WorkspaceService', () => {
  let service: WorkspaceService;

  const mockWorkspaceWork = {
    id: 'ws-1',
    name: 'work',
    isDefault: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockWorkspacePersonal = {
    id: 'ws-2',
    name: 'personal',
    isDefault: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockPrisma = {
    workspace: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspaceService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<WorkspaceService>(WorkspaceService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getDefault', () => {
    it('should return the workspace with isDefault=true', async () => {
      mockPrisma.workspace.findFirst.mockResolvedValue(mockWorkspaceWork);

      const result = await service.getDefault();

      expect(result).toEqual(mockWorkspaceWork);
      expect(mockPrisma.workspace.findFirst).toHaveBeenCalledWith({
        where: { isDefault: true },
      });
    });

    it('should throw NotFoundException when no default workspace exists', async () => {
      mockPrisma.workspace.findFirst.mockResolvedValue(null);

      await expect(service.getDefault()).rejects.toThrow(NotFoundException);
    });
  });

  describe('setDefault', () => {
    it('should unset current default and set new one via transaction', async () => {
      mockPrisma.$transaction.mockResolvedValue([{}, {}]);
      mockPrisma.workspace.findUnique.mockResolvedValue({
        ...mockWorkspacePersonal,
        isDefault: true,
      });

      const result = await service.setDefault('personal' as any);

      expect(mockPrisma.$transaction).toHaveBeenCalledWith([
        mockPrisma.workspace.updateMany({
          where: { isDefault: true },
          data: { isDefault: false },
        }),
        mockPrisma.workspace.update({
          where: { name: 'personal' },
          data: { isDefault: true },
        }),
      ]);
      expect(result).toEqual(
        expect.objectContaining({ name: 'personal', isDefault: true }),
      );
    });
  });

  describe('findAll', () => {
    it('should return all workspaces', async () => {
      const allWorkspaces = [mockWorkspaceWork, mockWorkspacePersonal];
      mockPrisma.workspace.findMany.mockResolvedValue(allWorkspaces);

      const result = await service.findAll();

      expect(result).toEqual(allWorkspaces);
      expect(mockPrisma.workspace.findMany).toHaveBeenCalled();
    });
  });

  describe('findByName', () => {
    it('should return workspace by name', async () => {
      mockPrisma.workspace.findUnique.mockResolvedValue(mockWorkspaceWork);

      const result = await service.findByName('work' as any);

      expect(result).toEqual(mockWorkspaceWork);
      expect(mockPrisma.workspace.findUnique).toHaveBeenCalledWith({
        where: { name: 'work' },
      });
    });

    it('should return null when workspace not found', async () => {
      mockPrisma.workspace.findUnique.mockResolvedValue(null);

      const result = await service.findByName('personal' as any);

      expect(result).toBeNull();
    });
  });
});
