import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { parseId } from '../common/bigint';
import { ProjectPermission, ProjectRole, SystemRole } from '../common/decorators';
import { CreateRoleDto, UpdateBuiltinRoleDto, UpdateRoleDto } from './roles.dto';
import { RolesService } from './roles.service';

@ApiTags('roles')
@SystemRole('admin')
@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get() listRoles() { return this.roles.list(); }
  @Post() createRole(@Body() dto: CreateRoleDto) { return this.roles.create(dto); }
  @Patch('builtin/:key') updateBuiltinRole(@Param('key') key: string, @Body() dto: UpdateBuiltinRoleDto) {
    return this.roles.updateBuiltin(key, dto);
  }
  @Patch(':id') updateRole(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.roles.update(parseId(id, 'ROLE_NOT_FOUND'), dto);
  }
  @Delete(':id') deleteRole(@Param('id') id: string) { return this.roles.remove(parseId(id, 'ROLE_NOT_FOUND')); }
}

@ApiTags('roles')
@Controller('projects/:projectKey/role-options')
export class ProjectRoleOptionsController {
  constructor(private readonly roles: RolesService) {}

  @ProjectRole('admin')
  @ProjectPermission(['project.members.create', 'project.members.edit'])
  @Get() listRoleOptions() { return this.roles.list(); }
}
