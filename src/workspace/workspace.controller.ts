import { Controller, Get, UseGuards } from '@nestjs/common';
import { WorkspaceService } from './workspace.service';
import { ApiKeyGuard } from '../guards/api-key.guard';

@Controller('api/workspaces')
@UseGuards(ApiKeyGuard)
export class WorkspaceController {
  constructor(private readonly workspaceService: WorkspaceService) {}

  @Get()
  findAll() {
    return this.workspaceService.findAll();
  }
}
