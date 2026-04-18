import {
  IsString,
  IsOptional,
  IsEnum,
  MinLength,
  IsUUID,
  IsDateString,
  IsInt,
  Min,
} from 'class-validator';
import { TaskStatus } from '../../../prisma/generated/prisma/client/enums';
import { TaskPriority } from '../../../prisma/generated/prisma/client/enums';

export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  sourceInput?: string;

  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @IsOptional()
  @IsDateString()
  deadline?: string;

  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;

  @IsOptional()
  @IsString()
  blockedReason?: string;

  @IsOptional()
  @IsDateString()
  deferredUntil?: string;
}
