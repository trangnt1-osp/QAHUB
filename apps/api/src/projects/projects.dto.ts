import { DEFAULT_TEST_CATEGORIES, PROJECT_KEY_REGEX, PROJECT_ROLES, ProjectRole } from '@ospm/shared';
import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, Matches, Min, MinLength, ValidateIf } from 'class-validator';

export class CreateProjectDto {
  @ValidateIf((_object, value) => value !== undefined) @IsIn(['sprint', 'phase']) trackingMode?: 'sprint' | 'phase';
  @IsString() @Matches(PROJECT_KEY_REGEX, { message: 'key phải gồm 2–10 ký tự A–Z, 0–9 và bắt đầu bằng chữ' }) key: string;
  @IsString() @MinLength(1) name: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsInt() leadId?: number;
  @IsInt() workflowTemplateId: number;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsDateString({ strict: true }) startDate?: string | null;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsDateString({ strict: true }) endDate?: string | null;
}

export class UpdateProjectDto {
  @ValidateIf((_object, value) => value !== undefined) @IsIn(['sprint', 'phase']) trackingMode?: 'sprint' | 'phase';
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsInt() leadId?: number | null;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsDateString({ strict: true }) startDate?: string | null;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsDateString({ strict: true }) endDate?: string | null;
}

export class AddMemberDto {
  @IsInt() userId: number;
  @ValidateIf((_object, value) => value !== undefined) @IsIn(PROJECT_ROLES as unknown as string[]) role?: ProjectRole;
  @ValidateIf((_object, value) => value !== undefined) @IsInt() @Min(1) roleId?: number;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsDateString({ strict: true }) joinedAt?: string;
}

export class ListMembersQuery {
  @IsOptional() @IsIn(['active', 'all']) status?: 'active' | 'all';
}

export class LeaveMemberDto {
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsDateString({ strict: true }) leftAt?: string;
}

export class UpdateMemberDto {
  @ValidateIf((_object, value) => value !== undefined) @IsIn(PROJECT_ROLES as unknown as string[]) role?: ProjectRole;
  @ValidateIf((_object, value) => value !== undefined) @IsInt() @Min(1) roleId?: number;
}

export class UpdateSettingsDto {
  @IsOptional() @IsBoolean() createBugForFlaky?: boolean;
}

export const TEST_CATEGORY_DEFAULTS = DEFAULT_TEST_CATEGORIES;
