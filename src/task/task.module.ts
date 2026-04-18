import { Module, forwardRef } from '@nestjs/common';
import { TaskService } from './task.service';
import { TaskController } from './task.controller';
import { WorkspaceModule } from '../workspace/workspace.module';
import { SchedulerModule } from '../scheduler/scheduler.module';

@Module({
  imports: [WorkspaceModule, forwardRef(() => SchedulerModule)],
  controllers: [TaskController],
  providers: [TaskService],
  exports: [TaskService],
})
export class TaskModule {}
