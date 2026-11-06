import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';
import { CurrentProject, ProjectContext, ProjectRole } from '../common/decorators';
import { PaginationQuery } from '../common/pagination';
import { parseSummaryFilter, SummaryService } from './summary.service';
import type { ContributorPeriod } from './bug-contributors';

export class BugContributorsQuery {
  @IsOptional() @IsIn(['week', 'month']) period?: ContributorPeriod;
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) date?: string;
}

export class SummaryQuery {
  @IsOptional() @IsString() assigneeIds?: string;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsString() source?: string;
  @IsOptional() @IsIn(['open', 'all']) scope?: 'open' | 'all';
  @IsOptional() @IsString() sprintId?: string;
}

@ApiTags('summary')
@Controller('projects/:projectKey')
export class SummaryController {
  constructor(private readonly summary: SummaryService) {}

  @ProjectRole('viewer') @Get('summary')
  getSummary(@CurrentProject() p: ProjectContext, @Query() q: SummaryQuery) {
    return this.summary.summary(p.id, parseSummaryFilter(q));
  }

  @ProjectRole('viewer') @Get('bug-contributors')
  getBugContributors(@CurrentProject() p: ProjectContext, @Query() q: BugContributorsQuery) {
    return this.summary.bugContributors(p.id, q.period ?? 'week', q.date);
  }

  @ProjectRole('viewer') @Get('activity')
  getProjectActivity(@CurrentProject() p: ProjectContext, @Query() q: PaginationQuery) {
    return this.summary.recentActivity([p.id], q.cursor, q.limit);
  }
}
