import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';

const kinds = ['dev', 'sit', 'uat', 'staging', 'production', 'other'];
const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;
class EnvironmentFields {
  @IsOptional() @IsString() @MaxLength(2000) appUrl?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) apiUrl?: string | null;
  @IsOptional() @IsString() @MaxLength(100) deployedVersion?: string | null;
  @IsOptional() @IsInt() @Min(1) ownerId?: number | null;
  @ValidateIf((_, v) => v !== undefined) @IsIn(['active', 'maintenance', 'inactive']) status?: string;
  @IsOptional() @IsString() @MaxLength(8000) notes?: string | null;
}
export class CreateEnvironmentDto extends EnvironmentFields {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(100) name: string;
  @IsIn(kinds) kind: string;
}
export class UpdateEnvironmentDto extends EnvironmentFields {
  @IsInt() @Min(1) version: number;
  @ValidateIf((_, v) => v !== undefined) @Transform(trim) @IsString() @MinLength(1) @MaxLength(100) name?: string;
  @ValidateIf((_, v) => v !== undefined) @IsIn(kinds) kind?: string;
}
export class DeleteEnvironmentQuery {
  @Type(() => Number) @IsInt() @Min(1) version: number;
}
