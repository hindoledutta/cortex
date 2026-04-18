import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { TaskService } from './task.service';
import { UpdateTaskDto } from './dto/update-task.dto';
import { ApiKeyGuard } from '../guards/api-key.guard';

@Controller('api/tasks')
@UseGuards(ApiKeyGuard)
export class TaskController {
  constructor(private readonly taskService: TaskService) {}

  @Get()
  findAll(@Query('workspaceId') workspaceId?: string) {
    if (workspaceId) {
      return this.taskService.findAll(workspaceId);
    }
    return this.taskService.findAllAcrossWorkspaces();
  }

  @Get(':id')
  findOne(
    @Param('id') id: string,
    @Query('workspaceId') workspaceId: string,
  ) {
    return this.taskService.findOne(id, workspaceId);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Query('workspaceId') workspaceId: string,
    @Body() dto: UpdateTaskDto,
  ) {
    return this.taskService.update(id, workspaceId, dto);
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @Query('workspaceId') workspaceId: string,
  ) {
    return this.taskService.softDelete(id, workspaceId);
  }
}
