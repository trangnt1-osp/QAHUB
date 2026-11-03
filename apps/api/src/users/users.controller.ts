import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { parseId } from '../common/bigint';
import { AuthUser, CurrentUser, SystemRole } from '../common/decorators';
import { CreateUserDto, ListUsersQuery, UpdateUserDto } from './users.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  // Mọi thành viên đều cần danh sách để chọn assignee; chỉ trả thông tin công khai.
  @Get() listUsers(@Query() q: ListUsersQuery) {
    return this.users.list(q);
  }

  @SystemRole('admin') @Get(':id') getUserDetail(@Param('id') id: string) {
    return this.users.detail(parseId(id, 'USER_NOT_FOUND'));
  }

  @SystemRole('admin') @Post() createUser(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }

  @SystemRole('admin') @Patch(':id') updateUser(@Param('id') id: string, @Body() dto: UpdateUserDto, @CurrentUser() actor: AuthUser) {
    return this.users.update(parseId(id), dto, actor.id);
  }

  @SystemRole('admin') @Post(':id/reset-password') @HttpCode(200)
  resetUserPassword(@Param('id') id: string) {
    return this.users.resetPassword(parseId(id));
  }
}
