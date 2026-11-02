import { SYSTEM_ROLES, SystemRole } from '@ospm/shared';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, MinLength, ValidateIf } from 'class-validator';

export class CreateUserDto {
  @IsEmail() email: string;
  @IsString() @MinLength(1) displayName: string;
  @IsIn(SYSTEM_ROLES as unknown as string[]) systemRole: SystemRole;
  @IsString() @MinLength(8) password: string;
}

export class UpdateUserDto {
  @ValidateIf((_o, v) => v !== undefined)
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail() email?: string;

  @ValidateIf((_o, v) => v !== undefined)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @MinLength(1) displayName?: string;

  @ValidateIf((_o, v) => v !== undefined) @IsIn(SYSTEM_ROLES as unknown as string[]) systemRole?: SystemRole;
  @ValidateIf((_o, v) => v !== undefined) @IsBoolean() isActive?: boolean;
}

export class ListUsersQuery {
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsIn(['active', 'inactive']) status?: 'active' | 'inactive';
}
