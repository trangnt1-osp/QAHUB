import { ISSUE_TYPES, IssueType, LINK_TYPES, LinkType, PRIORITIES, Priority, TRIAGE_ACTIONS, TriageAction } from '@ospm/shared';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsObject, IsOptional, IsString, Matches, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { PaginationQuery } from '../common/pagination';

const csv = () => Transform(({ value }) => (typeof value === 'string' ? value.split(',').filter(Boolean) : value));

export class ListIssuesQuery extends PaginationQuery {
  @IsOptional() @IsString() q?: string;
  @IsOptional() @csv() @IsArray() type?: string[];
  @IsOptional() @csv() @IsArray() @IsIn(PRIORITIES as unknown as string[], { each: true }) priority?: Priority[];
  @IsOptional() @csv() @IsArray() statusIds?: string[];
  @IsOptional() @IsIn(['open', 'done']) statusCategory?: 'open' | 'done';
  @IsOptional() @IsDateString({ strict: true }) createdFrom?: string;
  @IsOptional() @IsDateString() createdAfter?: string;
  @IsOptional() @IsString() reporterId?: string;
  @IsOptional() @csv() @IsArray() assigneeIds?: string[];
  @IsOptional() @csv() @IsArray() labelIds?: string[];
  @IsOptional() @IsString() functionId?: string;
  @IsOptional() @IsString() moduleId?: string;
  @IsOptional() @IsString() epicId?: string;
  /** id sprint, hoặc "backlog" để lấy item chưa vào sprint */
  @IsOptional() @IsString() sprintId?: string;
  @IsOptional() @IsIn(['manual', 'auto']) source?: 'manual' | 'auto';
  @IsOptional() @Transform(({ value }) => value === true || value === 'true') @IsBoolean() includeAllPeriods?: boolean;
}

export class CreateIssueDto {
  @IsIn(ISSUE_TYPES as unknown as string[]) type: IssueType;
  @IsString() @MinLength(1) @MaxLength(255) title: string;
  @IsOptional() @IsObject() description?: Record<string, unknown>;
  @IsOptional() @IsIn(PRIORITIES as unknown as string[]) priority?: Priority;
  @IsOptional() @IsInt() assigneeId?: number;
  @IsOptional() @IsString() parentKey?: string;
  @IsOptional() @IsInt() sprintId?: number;
  @IsOptional() @IsInt() @Min(0) estimateMinutes?: number;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) dueDate?: string;
  @IsOptional() @IsArray() @IsInt({ each: true }) moduleIds?: number[];
  @IsOptional() @IsArray() @IsInt({ each: true }) functionIds?: number[];
  @IsOptional() @IsArray() @IsInt({ each: true }) labelIds?: number[];
}

export class UpdateIssueDto {
  /** Bắt buộc: dùng để chống ghi đè (409 VERSION_CONFLICT) */
  @IsInt() version: number;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(255) title?: string;
  @IsOptional() @IsObject() description?: Record<string, unknown> | null;
  @IsOptional() @IsIn(PRIORITIES as unknown as string[]) priority?: Priority;
  @IsOptional() @IsInt() assigneeId?: number | null;
  @IsOptional() @IsString() parentKey?: string | null;
  @IsOptional() @IsInt() sprintId?: number | null;
  @IsOptional() @IsInt() @Min(0) estimateMinutes?: number | null;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) dueDate?: string | null;
  @IsOptional() @IsArray() @IsInt({ each: true }) moduleIds?: number[];
  @IsOptional() @IsArray() @IsInt({ each: true }) functionIds?: number[];
  @IsOptional() @IsArray() @IsInt({ each: true }) labelIds?: number[];
  @IsOptional() @IsIn(ISSUE_TYPES as unknown as string[]) type?: IssueType;
}

export class TransitionDto {
  @IsInt() toStatusId: number;
}

export class TriageDto {
  @IsIn(TRIAGE_ACTIONS as unknown as string[]) action: TriageAction;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() duplicateOfKey?: string;
  @IsOptional() @IsInt() assigneeId?: number;
  @IsOptional() @IsInt() sprintId?: number;
  @IsOptional() @IsIn(PRIORITIES as unknown as string[]) priority?: Priority;
}

export class RankDto {
  @IsOptional() @IsString() beforeKey?: string;
  @IsOptional() @IsString() afterKey?: string;
  /** undefined = giữ nguyên; null = chuyển về backlog */
  @IsOptional() @IsInt() sprintId?: number | null;
}

export class BulkSetDto {
  @IsOptional() @IsInt() statusId?: number;
  @IsOptional() @IsInt() assigneeId?: number | null;
  @IsOptional() @IsInt() sprintId?: number | null;
  @IsOptional() @IsArray() @IsInt({ each: true }) moduleIds?: number[];
  @IsOptional() @IsArray() @IsInt({ each: true }) functionIds?: number[];
  @IsOptional() @IsArray() @IsInt({ each: true }) labelIds?: number[];
  @IsOptional() @IsIn(PRIORITIES as unknown as string[]) priority?: Priority;
  @IsOptional() deleted?: boolean;
}

export class BulkIssuesDto {
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(500) @IsString({ each: true }) issueKeys: string[];
  @ValidateNested() @Type(() => BulkSetDto) set: BulkSetDto;
}

export class CommentDto {
  @IsObject() body: Record<string, unknown>;
}

export class LinkDto {
  @IsString() targetKey: string;
  @IsIn(LINK_TYPES as unknown as string[]) type: LinkType;
}

export class LabelDto {
  @IsString() @MinLength(1) @MaxLength(50) name: string;
  @IsOptional() @Matches(/^#[0-9a-fA-F]{6}$/) color?: string;
}

export class UpdateLabelDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(50) name?: string;
  @IsOptional() @Matches(/^#[0-9a-fA-F]{6}$/) color?: string;
}
