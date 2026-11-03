import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { parseId } from '../common/bigint';
import { AuthUser, CurrentProject, CurrentUser, ProjectContext, ProjectRole } from '../common/decorators';
import { CompleteSprintDto, CreateSprintDto, StartSprintDto, UpdateSprintDto } from './sprints.dto';
import { SprintsService } from './sprints.service';

@ApiTags('sprints')
@Controller()
export class SprintsController {
  constructor(private readonly sprints: SprintsService) {}

  @ProjectRole('viewer') @Get('projects/:projectKey/sprints')
  listSprints(@CurrentProject() p: ProjectContext) {
    return this.sprints.list(p.id);
  }

  @ProjectRole('developer') @Post('projects/:projectKey/sprints')
  createSprint(@CurrentProject() p: ProjectContext, @Body() dto: CreateSprintDto, @CurrentUser() u: AuthUser) {
    return this.sprints.create(p.id, p.key, dto, u.id);
  }

  @ProjectRole('developer', 'sprint') @Patch('sprints/:id')
  updateSprint(@Param('id') id: string, @Body() dto: UpdateSprintDto, @CurrentUser() u: AuthUser) {
    return this.sprints.update(parseId(id), dto, u.id);
  }

  @ProjectRole('developer', 'sprint') @Post('sprints/:id/start') @HttpCode(200)
  startSprint(@Param('id') id: string, @Body() dto: StartSprintDto, @CurrentUser() u: AuthUser) {
    return this.sprints.start(parseId(id), dto, u.id);
  }

  @ProjectRole('developer', 'sprint') @Post('sprints/:id/complete') @HttpCode(200)
  completeSprint(@Param('id') id: string, @Body() dto: CompleteSprintDto, @CurrentUser() u: AuthUser) {
    return this.sprints.complete(parseId(id), dto, u.id);
  }

  @ProjectRole('developer', 'sprint') @Delete('sprints/:id') @HttpCode(204)
  deleteSprint(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.sprints.remove(parseId(id), u.id);
  }
}
