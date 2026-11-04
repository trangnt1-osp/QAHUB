import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { parseId } from '../common/bigint';
import { AuthUser, CurrentProject, CurrentUser, ProjectContext, ProjectPermission, ProjectRole } from '../common/decorators';
import { DeleteMasterplanQuery, MasterplanFields, UpdateMasterplanDto } from './masterplan.dto';
import { MasterplanService } from './masterplan.service';

@ApiTags('masterplan')
@Controller('projects/:projectKey/masterplan')
export class MasterplanController {
  constructor(private readonly masterplan: MasterplanService) {}
  @ProjectRole('viewer') @ProjectPermission('project.info.view') @Get()
  list(@CurrentProject() project: ProjectContext) { return this.masterplan.list(project.id); }
  @ProjectRole('viewer') @ProjectPermission('project.info.edit') @Get('options')
  options(@CurrentProject() project: ProjectContext) { return this.masterplan.options(project.id); }
  @ProjectRole('admin') @ProjectPermission('project.info.edit') @Post()
  create(@CurrentProject() project: ProjectContext, @CurrentUser() user: AuthUser, @Body() dto: MasterplanFields) { return this.masterplan.save(project.id, user.id, dto); }
  @ProjectRole('admin') @ProjectPermission('project.info.edit') @Patch(':id')
  update(@CurrentProject() project: ProjectContext, @CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateMasterplanDto) { return this.masterplan.save(project.id, user.id, dto, parseId(id)); }
  @ProjectRole('admin') @ProjectPermission('project.info.edit') @Delete(':id') @HttpCode(204)
  remove(@CurrentProject() project: ProjectContext, @CurrentUser() user: AuthUser, @Param('id') id: string, @Query() query: DeleteMasterplanQuery) { return this.masterplan.remove(project.id, user.id, parseId(id), query.version); }
}
