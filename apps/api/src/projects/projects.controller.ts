import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { parseId } from '../common/bigint';
import { AuthUser, CurrentProject, CurrentUser, ProjectContext, ProjectPermission, ProjectRole, SystemRole } from '../common/decorators';
import { AddMemberDto, CreateProjectDto, LeaveMemberDto, ListMembersQuery, UpdateMemberDto, UpdateProjectDto, UpdateSettingsDto } from './projects.dto';
import { ProjectsService } from './projects.service';

@ApiTags('projects')
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get() listProjects(@CurrentUser() u: AuthUser) {
    return this.projects.list(u);
  }

  @SystemRole('admin') @Post() createProject(@Body() dto: CreateProjectDto, @CurrentUser() u: AuthUser) {
    return this.projects.create(dto, u);
  }

  @ProjectRole('viewer') @Get(':projectKey') getProject(@CurrentProject() p: ProjectContext) {
    return this.projects.get(p.id, p.role, p.permissions);
  }

  @ProjectRole('admin') @Patch(':projectKey')
  updateProject(@CurrentProject() p: ProjectContext, @Body() dto: UpdateProjectDto, @CurrentUser() u: AuthUser) {
    return this.projects.update(p.id, dto, u.id);
  }

  @SystemRole('admin') @ProjectRole('admin') @Delete(':projectKey') @HttpCode(204)
  deleteProject(@CurrentProject() p: ProjectContext, @CurrentUser() u: AuthUser) {
    return this.projects.remove(p.id, u.id);
  }

  @ProjectRole('admin') @Patch(':projectKey/settings')
  updateProjectSettings(@CurrentProject() p: ProjectContext, @Body() dto: UpdateSettingsDto, @CurrentUser() u: AuthUser) {
    return this.projects.updateSettings(p.id, dto, u.id);
  }

  @ProjectRole('viewer') @Get(':projectKey/members') listProjectMembers(@CurrentProject() p: ProjectContext, @Query() q: ListMembersQuery) {
    return this.projects.listMembers(p.id, q.status === 'all');
  }

  @ProjectRole('viewer') @ProjectPermission(['issue.view', 'testcase.view', 'project.summary.view', 'project.members.view', 'settings.general.view']) @Get(':projectKey/members/options')
  listMemberOptions(@CurrentProject() p: ProjectContext) {
    return this.projects.memberOptions(p.id);
  }

  @ProjectRole('admin') @Post(':projectKey/members')
  addProjectMember(@CurrentProject() p: ProjectContext, @Body() dto: AddMemberDto) {
    return this.projects.addMember(p.id, dto, p.permissions);
  }

  @ProjectRole('admin') @Patch(':projectKey/members/:userId')
  updateProjectMember(@CurrentProject() p: ProjectContext, @Param('userId') userId: string, @Body() dto: UpdateMemberDto) {
    return this.projects.updateMember(p.id, parseId(userId), dto, p.permissions);
  }

  @ProjectRole('admin') @Delete(':projectKey/members/:userId') @HttpCode(204)
  removeProjectMember(@CurrentProject() p: ProjectContext, @Param('userId') userId: string) {
    return this.projects.removeMember(p.id, parseId(userId));
  }

  @ProjectRole('admin') @Post(':projectKey/members/:userId/leave') @HttpCode(200)
  leaveProjectMember(@CurrentProject() p: ProjectContext, @Param('userId') userId: string, @Body() dto: LeaveMemberDto) {
    return this.projects.removeMember(p.id, parseId(userId), dto.leftAt);
  }
}
