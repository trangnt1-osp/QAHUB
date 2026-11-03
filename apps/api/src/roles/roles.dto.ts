import { PERMISSION_KEYS, Permission } from '@ospm/shared';
import { Transform } from 'class-transformer';
import { ArrayUnique, IsArray, IsDefined, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;

export class CreateRoleDto {
  @Transform(trim) @IsString({ message: 'Mã vai trò phải là chuỗi.' }) @MinLength(1, { message: 'Mã vai trò không được để trống.' }) @MaxLength(64, { message: 'Mã vai trò không được vượt quá 64 ký tự.' })
  @Matches(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, { message: 'Mã vai trò phải bắt đầu bằng chữ thường và chỉ chứa chữ thường, chữ số, dấu gạch ngang giữa các từ.' })
  key: string;

  @Transform(trim) @IsString({ message: 'Tên vai trò phải là chuỗi.' }) @MinLength(1, { message: 'Tên vai trò không được để trống.' }) @MaxLength(100, { message: 'Tên vai trò không được vượt quá 100 ký tự.' })
  name: string;

  @IsOptional() @Transform(trim) @IsString({ message: 'Mô tả phải là chuỗi.' }) @MaxLength(1000, { message: 'Mô tả không được vượt quá 1000 ký tự.' })
  description?: string | null;

  @IsArray({ message: 'Quyền phải là một danh sách.' }) @ArrayUnique({ message: 'Danh sách quyền không được trùng lặp.' }) @IsIn(PERMISSION_KEYS, { each: true, message: 'Danh sách chứa quyền không hợp lệ.' })
  permissions: Permission[];
}

export class UpdateRoleDto {
  @ValidateIf((_o, value) => value !== undefined)
  @Transform(trim) @IsString({ message: 'Mã vai trò phải là chuỗi.' }) @MinLength(1, { message: 'Mã vai trò không được để trống.' }) @MaxLength(64, { message: 'Mã vai trò không được vượt quá 64 ký tự.' })
  @Matches(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, { message: 'Mã vai trò phải bắt đầu bằng chữ thường và chỉ chứa chữ thường, chữ số, dấu gạch ngang giữa các từ.' })
  key?: string;

  @ValidateIf((_o, value) => value !== undefined)
  @Transform(trim) @IsString({ message: 'Tên vai trò phải là chuỗi.' }) @MinLength(1, { message: 'Tên vai trò không được để trống.' }) @MaxLength(100, { message: 'Tên vai trò không được vượt quá 100 ký tự.' })
  name?: string;

  @IsOptional() @Transform(trim) @IsString({ message: 'Mô tả phải là chuỗi.' }) @MaxLength(1000, { message: 'Mô tả không được vượt quá 1000 ký tự.' })
  description?: string | null;

  @ValidateIf((_o, value) => value !== undefined)
  @IsArray({ message: 'Quyền phải là một danh sách.' }) @ArrayUnique({ message: 'Danh sách quyền không được trùng lặp.' }) @IsIn(PERMISSION_KEYS, { each: true, message: 'Danh sách chứa quyền không hợp lệ.' })
  permissions?: Permission[];
}

export class UpdateBuiltinRoleDto extends UpdateRoleDto {
  @IsDefined({ message: 'Cần cung cấp danh sách quyền.' })
  @IsArray()
  @ArrayUnique()
  @IsIn(PERMISSION_KEYS, { each: true })
  declare permissions: Permission[];
}
