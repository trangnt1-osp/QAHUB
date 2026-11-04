import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsDateString, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';

export class MasterplanFields {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @MinLength(1) @MaxLength(200) name: string;
  @IsOptional() @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) startDate?: string | null;
  @IsOptional() @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) endDate?: string | null;
  @IsOptional() @IsInt() @Min(1) ownerId?: number | null;
  @IsOptional() @IsString() @MaxLength(8000) acceptanceCriteria?: string | null;
  @IsOptional() @IsString() @MaxLength(8000) notes?: string | null;
  @IsOptional() @IsIn(['planned', 'in_progress', 'completed', 'on_hold']) status?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100) progress?: number;
  @ValidateIf((_, value) => value !== undefined) @IsArray() @ArrayMaxSize(500) @ArrayUnique() @IsInt({ each: true }) @Min(1, { each: true }) featureIds?: number[];
}
export class UpdateMasterplanDto extends MasterplanFields {
  @IsInt() @Min(1) version: number;
}
export class DeleteMasterplanQuery {
  @Type(() => Number) @IsInt() @Min(1) version: number;
}
