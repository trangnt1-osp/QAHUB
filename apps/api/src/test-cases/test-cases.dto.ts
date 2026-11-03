import { REQUIREMENT_KINDS, RequirementKind, TEST_CASE_PRIORITIES, TEST_CASE_STATUSES, TestCasePriority, TestCaseStatus } from '@ospm/shared';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Max, Min, MinLength, ValidateNested,
} from 'class-validator';

const csv = () => Transform(({ value }) => (typeof value === 'string' ? value.split(',').filter(Boolean) : value));

// ----- Epic / Function -----
export class CreateRequirementDto {
  @IsIn(REQUIREMENT_KINDS as unknown as string[]) kind: RequirementKind;
  @IsString() @MinLength(1) code: string;
  @IsString() @MinLength(1) name: string;
  @IsOptional() @IsInt() moduleId?: number | null;
  @IsOptional() @IsArray() @IsInt({ each: true }) moduleIds?: number[];
  @IsOptional() @IsString() traceRef?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) sources?: string[];
  /** function: các epic chứa nó */
  @IsOptional() @IsArray() @IsInt({ each: true }) epicIds?: number[];
  /** epic: các function thuộc nó */
  @IsOptional() @IsArray() @IsInt({ each: true }) functionIds?: number[];
}

export class UpdateRequirementDto {
  @IsOptional() @IsString() @MinLength(1) code?: string;
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsInt() moduleId?: number | null;
  @IsOptional() @IsArray() @IsInt({ each: true }) moduleIds?: number[];
  @IsOptional() @IsString() traceRef?: string | null;
  @IsOptional() @IsArray() @IsString({ each: true }) sources?: string[];
  @IsOptional() @IsArray() @IsInt({ each: true }) epicIds?: number[];
  @IsOptional() @IsArray() @IsInt({ each: true }) functionIds?: number[];
}

// ----- Test case -----
export class TestStepDto {
  @IsOptional() @IsString() id?: string;
  @IsOptional() @IsInt() no?: number;
  @IsString() action: string;
  @IsString() expected: string;
}

export class TestCaseFilterQuery {
  @IsOptional() @IsString() functionId?: string;
  @IsOptional() @IsString() moduleId?: string;
  @IsOptional() @IsString() epicId?: string;
  @IsOptional() @IsString() q?: string;
  @IsOptional() @csv() @IsArray() status?: string[];
  @IsOptional() @csv() @IsArray() categoryId?: string[];
  @IsOptional() @csv() @IsArray() priority?: string[];
}

export class ListTestCasesQuery extends TestCaseFilterQuery {
  /** rank | code | priority | status | updatedAt, thêm hậu tố ":desc" để đảo chiều */
  @IsOptional() @IsString() sort?: string;
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) limit?: number;
}

export class CreateTestCaseDto {
  @IsInt() functionId: number;
  @IsString() @MinLength(1) title: string;
  @IsOptional() @IsIn(TEST_CASE_PRIORITIES as unknown as string[]) priority?: TestCasePriority;
  @IsOptional() @IsInt() categoryId?: number | null;
  @IsOptional() @IsString() preconditions?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => TestStepDto) steps?: TestStepDto[];
  @IsOptional() @IsIn(TEST_CASE_STATUSES as unknown as string[]) status?: TestCaseStatus;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() automationTag?: string;
  @IsOptional() @IsString() beforeId?: string;
}

export class UpdateTestCaseDto {
  @IsInt() version: number;
  @IsOptional() @IsString() @MinLength(1) title?: string;
  @IsOptional() @IsIn(TEST_CASE_PRIORITIES as unknown as string[]) priority?: TestCasePriority;
  @IsOptional() @IsInt() categoryId?: number | null;
  @IsOptional() @IsString() preconditions?: string | null;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => TestStepDto) steps?: TestStepDto[];
  @IsOptional() @IsIn(TEST_CASE_STATUSES as unknown as string[]) status?: TestCaseStatus;
  @IsOptional() @IsString() notes?: string | null;
  @IsOptional() @IsString() automationTag?: string | null;
}

export class BulkTestCaseSetDto {
  @IsOptional() @IsIn(TEST_CASE_STATUSES as unknown as string[]) status?: TestCaseStatus;
  @IsOptional() @IsIn(TEST_CASE_PRIORITIES as unknown as string[]) priority?: TestCasePriority;
  @IsOptional() @IsInt() categoryId?: number | null;
  @IsOptional() @IsInt() functionId?: number;
  @IsOptional() @IsBoolean() deleted?: boolean;
}

export class BulkTestCasesDto {
  @IsOptional() @IsArray() @ArrayMaxSize(100000) @IsString({ each: true }) ids?: string[];
  @IsOptional() @IsObject() filter?: TestCaseFilterQuery;
  @ValidateNested() @Type(() => BulkTestCaseSetDto) set: BulkTestCaseSetDto;
}

export class MoveTestCaseDto {
  @IsOptional() @IsInt() functionId?: number;
  @IsOptional() @IsString() beforeId?: string;
  @IsOptional() @IsString() afterId?: string;
}

export class LinkBugDto {
  /** Gắn bug có sẵn */
  @IsOptional() @IsString() issueKey?: string;
  /** Hoặc tạo bug mới từ test case */
  @IsOptional() @IsBoolean() createBug?: boolean;
  @IsOptional() @IsString() title?: string;
}

export class SummaryQuery {
  @IsOptional() @IsString() functionId?: string;
  @IsOptional() @IsString() moduleId?: string;
  @IsOptional() @IsString() epicId?: string;
}

export class CategoryDto {
  @IsString() @MinLength(1) name: string;
  @IsOptional() @IsInt() position?: number;
}

export class UpdateCategoryDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsInt() position?: number;
}

export class CommitImportDto {
  @IsString() previewJobId: string;
}
