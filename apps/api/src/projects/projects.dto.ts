import { DEFAULT_TEST_CATEGORIES, PROJECT_KEY_REGEX, PROJECT_ROLES, ProjectRole } from '@ospm/shared';
import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class CreateProjectDto {
  @IsString() @Matches(PROJECT_KEY_REGEX, { message: 'key phải gồm 2–10 ký tự A–Z, 0–9 và bắt đầu bằng chữ' }) key: string;
  @IsString() @MinLength(1) name: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsInt() leadId?: number;
  @IsInt() workflowTemplateId: number;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsDateString({ strict: true }) startDate?: string | null;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsDateString({ strict: true }) endDate?: string | null;
}

export class UpdateProjectDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsInt() leadId?: number | null;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsDateString({ strict: true }) startDate?: string | null;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsDateString({ strict: true }) endDate?: string | null;
}

export class AddMemberDto {
  @IsInt() userId: number;
  @IsIn(PROJECT_ROLES as unknown as string[]) role: ProjectRole;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsDateString({ strict: true }) joinedAt?: string;
}

export class ListMembersQuery {
  @IsOptional() @IsIn(['active', 'all']) status?: 'active' | 'all';
}

export class LeaveMemberDto {
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsDateString({ strict: true }) leftAt?: string;
}

export class UpdateMemberDto {
  @IsIn(PROJECT_ROLES as unknown as string[]) role: ProjectRole;
}

export class UpdateSettingsDto {
  @IsOptional() @IsBoolean() createBugForFlaky?: boolean;
}

export const TEST_CATEGORY_DEFAULTS = DEFAULT_TEST_CATEGORIES;
