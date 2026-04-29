import { Module, forwardRef } from '@nestjs/common';
import { TaskModule } from '../task/task.module';
import { LlmService } from './llm.service';
import { DecompositionService } from './decomposition.service';
import { ClassificationService } from './classification.service';
import { FollowUpService } from './follow-up.service';
import { EnrichmentService } from './enrichment.service';
import { CommentProcessingService } from './comment-processing.service';
import { CalendarExtractionService } from './calendar-extraction.service';
import { DirectCalendarExtractionService } from './direct-calendar-extraction.service';
import { SlugService } from './slug.service';

@Module({
  imports: [forwardRef(() => TaskModule)],
  providers: [
    LlmService,
    DecompositionService,
    ClassificationService,
    FollowUpService,
    EnrichmentService,
    CommentProcessingService,
    CalendarExtractionService,
    DirectCalendarExtractionService,
    SlugService,
  ],
  exports: [
    LlmService,
    DecompositionService,
    ClassificationService,
    FollowUpService,
    EnrichmentService,
    CommentProcessingService,
    CalendarExtractionService,
    DirectCalendarExtractionService,
    SlugService,
  ],
})
export class LlmModule {}
