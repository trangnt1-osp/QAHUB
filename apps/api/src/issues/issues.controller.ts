import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { parseId } from '../common/bigint';
import { AuthUser, CurrentProject, CurrentUser, ProjectContext, ProjectRole } from '../common/decorators';
import { PaginationQuery } from '../common/pagination';
import {
  BulkIssuesDto, CommentDto, CreateIssueDto, LabelDto, LinkDto, ListIssuesQuery, RankDto, TransitionDto, TriageDto, UpdateIssueDto, UpdateLabelDto,
} from './issues.dto';
import { IssuesService } from './issues.service';
import { LabelsService } from './labels.service';

@ApiTags('issues')
@Controller()
export class IssuesController {
  constructor(private readonly issues: IssuesService, private readonly labels: LabelsService) {}

  @ProjectRole('viewer') @Get('projects/:projectKey/issues')
  listIssues(@CurrentProject() p: ProjectContext, @Query() q: ListIssuesQuery) {
    return this.issues.list(p, q);
  }

  @ProjectRole('developer') @Post('projects/:projectKey/issues')
  createIssue(@CurrentProject() p: ProjectContext, @Body() dto: CreateIssueDto, @CurrentUser() u: AuthUser) {
    return this.issues.create(p, dto, u);
  }

  @ProjectRole('developer') @Post('projects/:projectKey/issues/bulk') @HttpCode(200)
  bulkUpdateIssues(@CurrentProject() p: ProjectContext, @Body() dto: BulkIssuesDto, @CurrentUser() u: AuthUser) {
    return this.issues.bulk(p, dto, u);
  }

  @ProjectRole('viewer') @Get('issues/:issueKey')
  getIssue(@Param('issueKey') key: string) {
    return this.issues.detail(key);
  }

  @ProjectRole('developer') @Patch('issues/:issueKey')
  updateIssue(@Param('issueKey') key: string, @Body() dto: UpdateIssueDto, @CurrentUser() u: AuthUser) {
    return this.issues.update(key, dto, u);
  }

  @ProjectRole('developer') @Post('issues/:issueKey/transitions') @HttpCode(200)
  transitionIssue(@Param('issueKey') key: string, @Body() dto: TransitionDto, @CurrentUser() u: AuthUser, @CurrentProject() p: ProjectContext) {
    return this.issues.transition(key, dto, { ...u, permissions: p.permissions }, p.role);
  }

  @ProjectRole('tester') @Post('issues/:issueKey/triage') @HttpCode(200)
  triageIssue(@Param('issueKey') key: string, @Body() dto: TriageDto, @CurrentUser() u: AuthUser) {
    return this.issues.triage(key, dto, u);
  }

  @ProjectRole('developer') @Post('issues/:issueKey/rank') @HttpCode(200)
  rankIssue(@Param('issueKey') key: string, @Body() dto: RankDto, @CurrentUser() u: AuthUser) {
    return this.issues.rank(key, dto, u);
  }

  @ProjectRole('developer') @Delete('issues/:issueKey') @HttpCode(204)
  deleteIssue(@Param('issueKey') key: string, @CurrentUser() u: AuthUser, @CurrentProject() p: ProjectContext) {
    return this.issues.remove(key, { ...u, permissions: p.permissions }, p.role);
  }

  @ProjectRole('viewer') @Get('issues/:issueKey/comments')
  listComments(@Param('issueKey') key: string) {
    return this.issues.listComments(key);
  }

  @ProjectRole('developer') @Post('issues/:issueKey/comments')
  addComment(@Param('issueKey') key: string, @Body() dto: CommentDto, @CurrentUser() u: AuthUser) {
    return this.issues.addComment(key, dto.body, u);
  }

  @ProjectRole('developer', 'comment') @Patch('comments/:id')
  updateComment(@Param('id') id: string, @Body() dto: CommentDto, @CurrentUser() u: AuthUser, @CurrentProject() p: ProjectContext) {
    return this.issues.updateComment(parseId(id), dto.body, u, p.role);
  }

  @ProjectRole('developer', 'comment') @Delete('comments/:id') @HttpCode(204)
  deleteComment(@Param('id') id: string, @CurrentUser() u: AuthUser, @CurrentProject() p: ProjectContext) {
    return this.issues.deleteComment(parseId(id), u, p.role);
  }

  @ProjectRole('developer') @Post('issues/:issueKey/links')
  addIssueLink(@Param('issueKey') key: string, @Body() dto: LinkDto, @CurrentUser() u: AuthUser) {
    return this.issues.addLink(key, dto.targetKey, dto.type, u);
  }

  @ProjectRole('developer') @Delete('issues/:issueKey/links') @HttpCode(204)
  removeIssueLink(@Param('issueKey') key: string, @Query('linkId') linkId: string, @CurrentUser() u: AuthUser) {
    return this.issues.removeLink(key, parseId(linkId), u);
  }

  @ProjectRole('viewer') @Get('issues/:issueKey/activity')
  getIssueActivity(@Param('issueKey') key: string, @Query() q: PaginationQuery) {
    return this.issues.activityFor(key, q.cursor, q.limit);
  }

  // ----- Label -----
  @ProjectRole('viewer') @Get('projects/:projectKey/labels')
  listLabels(@CurrentProject() p: ProjectContext) {
    return this.labels.list(p.id);
  }

  @ProjectRole('developer') @Post('projects/:projectKey/labels')
  createLabel(@CurrentProject() p: ProjectContext, @Body() dto: LabelDto) {
    return this.labels.create(p.id, dto);
  }

  @ProjectRole('admin') @Patch('projects/:projectKey/labels/:labelId')
  updateLabel(@CurrentProject() p: ProjectContext, @Param('labelId') id: string, @Body() dto: UpdateLabelDto) {
    return this.labels.update(p.id, parseId(id), dto);
  }

  @ProjectRole('admin') @Delete('projects/:projectKey/labels/:labelId') @HttpCode(204)
  deleteLabel(@CurrentProject() p: ProjectContext, @Param('labelId') id: string) {
    return this.labels.remove(p.id, parseId(id));
  }
}
