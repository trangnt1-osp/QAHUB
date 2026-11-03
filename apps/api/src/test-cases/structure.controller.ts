import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { IsOptional, IsString, MinLength } from 'class-validator';
import { CurrentProject, ProjectContext, ProjectPermission, ProjectRole } from '../common/decorators';
import { parseId } from '../common/bigint';
import { StructureService } from './structure.service';
class CreateModuleDto {
  @IsString() @MinLength(1) code: string;
  @IsString() @MinLength(1) name: string;
  @IsOptional() @IsString() description?: string;
}
class UpdateModuleDto {
  @IsOptional() @IsString() @MinLength(1) code?: string;
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsString() description?: string | null;
}
@Controller('projects/:projectKey')
export class StructureController {
  constructor(private readonly structure: StructureService) {}
  @ProjectRole('viewer') @ProjectPermission('project.structure.view') @Get('structure')
  getStructure(@CurrentProject() p: ProjectContext) { return this.structure.options(p.id); }
  @ProjectRole('viewer') @ProjectPermission(['issue.view','testcase.view','project.structure.view']) @Get('structure/options')
  getOptions(@CurrentProject() p: ProjectContext) { return this.structure.options(p.id); }
  @ProjectRole('developer') @ProjectPermission('requirement.create') @Post('modules')
  create(@CurrentProject() p: ProjectContext, @Body() dto: CreateModuleDto) { return this.structure.saveModule(p.id,dto); }
  @ProjectRole('developer') @ProjectPermission('requirement.edit') @Patch('modules/:id')
  update(@CurrentProject() p: ProjectContext, @Param('id') id: string, @Body() dto: UpdateModuleDto) { return this.structure.saveModule(p.id,dto,parseId(id)); }
  @ProjectRole('tester') @ProjectPermission('requirement.delete') @Delete('modules/:id') @HttpCode(204)
  remove(@CurrentProject() p: ProjectContext, @Param('id') id: string) { return this.structure.removeModule(p.id,parseId(id)); }
}
