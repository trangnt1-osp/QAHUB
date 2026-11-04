import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from 'class-validator';

const kinds = ['dev', 'sit', 'uat', 'staging', 'production', 'other'];
const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;
export class EnvironmentAccountDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(200) username: string;
  @IsString() @MaxLength(2000) password: string;
  @IsOptional() @IsString() @MaxLength(100) role?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}
class EnvironmentFields {
  @ValidateIf((_, value) => value !== undefined) @IsArray() @ArrayMaxSize(50)
  @ValidateNested({ each: true }) @Type(() => EnvironmentAccountDto) accounts?: EnvironmentAccountDto[];
  @IsOptional() @IsString() @MaxLength(2000) appUrl?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) apiUrl?: string | null;
  @IsOptional() @IsString() @MaxLength(100) deployedVersion?: string | null;
  @IsOptional() @IsInt() @Min(1) ownerId?: number | null;
  @ValidateIf((_, v) => v !== undefined) @IsIn(['active', 'maintenance', 'inactive']) status?: string;
  @IsOptional() @IsString() @MaxLength(8000) notes?: string | null;
}
export class CreateEnvironmentDto extends EnvironmentFields {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(100) name: string;
  @IsOptional() @IsIn(kinds) kind?: string;
}
export class UpdateEnvironmentDto extends EnvironmentFields {
  @IsInt() @Min(1) version: number;
  @ValidateIf((_, v) => v !== undefined) @Transform(trim) @IsString() @MinLength(1) @MaxLength(100) name?: string;
  @ValidateIf((_, v) => v !== undefined) @IsIn(kinds) kind?: string;
}
export class DeleteEnvironmentQuery {
  @Type(() => Number) @IsInt() @Min(1) version: number;
}
