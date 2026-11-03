import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { parseId } from '../common/bigint';
import { AuthUser, CurrentProject, CurrentUser, ProjectContext, ProjectPermission, ProjectRole } from '../common/decorators';
import { CreateEnvironmentDto, DeleteEnvironmentQuery, UpdateEnvironmentDto } from './environments.dto';
import { EnvironmentsService } from './environments.service';

@ApiTags('project-environments')
@Controller('projects/:projectKey/environments')
export class EnvironmentsController {
  constructor(private readonly environments: EnvironmentsService) {}
  @ProjectRole('viewer') @ProjectPermission(['project.info.view']) @Get()
  list(@CurrentProject() project: ProjectContext) { return this.environments.list(project.id); }
  @ProjectRole('viewer') @ProjectPermission(['project.info.edit']) @Get('owners')
  owners(@CurrentProject() project: ProjectContext) { return this.environments.ownerOptions(project.id); }
  @ProjectRole('admin') @ProjectPermission(['project.info.edit']) @Post()
  create(@CurrentProject() project: ProjectContext, @CurrentUser() user: AuthUser, @Body() dto: CreateEnvironmentDto) { return this.environments.save(project.id, user.id, dto); }
  @ProjectRole('admin') @ProjectPermission(['project.info.edit']) @Patch(':id')
  update(@CurrentProject() project: ProjectContext, @CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateEnvironmentDto) { return this.environments.save(project.id, user.id, dto, parseId(id)); }
  @ProjectRole('admin') @ProjectPermission(['project.info.edit']) @Delete(':id') @HttpCode(204)
  remove(@CurrentProject() project: ProjectContext, @CurrentUser() user: AuthUser, @Param('id') id: string, @Query() query: DeleteEnvironmentQuery) { return this.environments.remove(project.id, user.id, parseId(id), query.version); }
}
