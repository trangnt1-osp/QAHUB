import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import { ERROR_CODES } from '@ospm/shared';
import { randomUUID } from 'node:crypto';
import { StorageService } from '../attachments/storage.service';
import { parseId } from '../common/bigint';
import { AuthUser, CurrentProject, CurrentUser, ProjectContext, ProjectRole } from '../common/decorators';
import { badRequest } from '../common/errors';
import { notFound } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { QueueService } from '../queue/queue.service';
import { ExcelService } from './excel.service';
import { RequirementsService } from './requirements.service';
import {
  BulkTestCasesDto, CategoryDto, CommitImportDto, CreateRequirementDto, CreateTestCaseDto, LinkBugDto, ListTestCasesQuery, MoveTestCaseDto, SummaryQuery,
  TestCaseFilterQuery, UpdateCategoryDto, UpdateRequirementDto, UpdateTestCaseDto,
} from './test-cases.dto';
import { TestCasesService } from './test-cases.service';

@ApiTags('test-cases')
@Controller()
export class TestCasesController {
  constructor(
    private readonly reqs: RequirementsService,
    private readonly cases: TestCasesService,
    private readonly excel: ExcelService,
    private readonly storage: StorageService,
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  // ----- Epic / Function -----
  @ProjectRole('viewer') @Get('projects/:projectKey/requirements')
  listRequirements(@CurrentProject() p: ProjectContext) {
    return this.reqs.tree(p.id);
  }

  @ProjectRole('developer') @Post('projects/:projectKey/requirements')
  createRequirement(@CurrentProject() p: ProjectContext, @Body() dto: CreateRequirementDto, @CurrentUser() u: AuthUser) {
    return this.reqs.create(p.id, p.key, dto, u.id);
  }

  @ProjectRole('developer', 'requirement') @Patch('requirements/:id')
  updateRequirement(@Param('id') id: string, @Body() dto: UpdateRequirementDto, @CurrentUser() u: AuthUser) {
    return this.reqs.update(parseId(id, ERROR_CODES.REQUIREMENT_NOT_FOUND), dto, u.id);
  }

  @ProjectRole('tester', 'requirement') @Delete('requirements/:id') @HttpCode(204)
  deleteRequirement(@Param('id') id: string, @CurrentUser() u: AuthUser, @CurrentProject() p: ProjectContext) {
    return this.reqs.remove(parseId(id, ERROR_CODES.REQUIREMENT_NOT_FOUND), u.id, p.permissions);
  }

  // ----- Category -----
  @ProjectRole('viewer') @Get('projects/:projectKey/test-categories')
  listTestCategories(@CurrentProject() p: ProjectContext) {
    return this.cases.listCategories(p.id);
  }

  @ProjectRole('tester') @Post('projects/:projectKey/test-categories')
  createTestCategory(@CurrentProject() p: ProjectContext, @Body() dto: CategoryDto) {
    return this.cases.createCategory(p.id, dto);
  }

  @ProjectRole('tester') @Patch('projects/:projectKey/test-categories/:categoryId')
  updateTestCategory(@CurrentProject() p: ProjectContext, @Param('categoryId') id: string, @Body() dto: UpdateCategoryDto) {
    return this.cases.updateCategory(p.id, parseId(id), dto);
  }

  @ProjectRole('tester') @Delete('projects/:projectKey/test-categories/:categoryId') @HttpCode(204)
  deleteTestCategory(@CurrentProject() p: ProjectContext, @Param('categoryId') id: string) {
    return this.cases.deleteCategory(p.id, parseId(id));
  }

  // ----- Test case -----
  @ProjectRole('viewer') @Get('projects/:projectKey/test-cases')
  listTestCases(@CurrentProject() p: ProjectContext, @Query() q: ListTestCasesQuery) {
    return this.cases.list(p.id, q);
  }

  @ProjectRole('viewer') @Get('projects/:projectKey/test-cases/ids')
  listTestCaseIds(@CurrentProject() p: ProjectContext, @Query() q: TestCaseFilterQuery) {
    return this.cases.ids(p.id, q);
  }

  @ProjectRole('viewer') @Get('projects/:projectKey/test-cases/summary')
  getTestCaseSummary(@CurrentProject() p: ProjectContext, @Query() q: SummaryQuery) {
    return this.cases.summary(p.id, q);
  }

  @ProjectRole('developer') @Post('projects/:projectKey/test-cases')
  createTestCase(@CurrentProject() p: ProjectContext, @Body() dto: CreateTestCaseDto, @CurrentUser() u: AuthUser) {
    return this.cases.create(p, dto, u);
  }

  @ProjectRole('developer') @Post('projects/:projectKey/test-cases/bulk') @HttpCode(200)
  bulkUpdateTestCases(@CurrentProject() p: ProjectContext, @Body() dto: BulkTestCasesDto, @CurrentUser() u: AuthUser) {
    return this.cases.bulk(p, dto, u);
  }

  @ProjectRole('viewer', 'testCase') @Get('test-cases/:id')
  getTestCase(@Param('id') id: string) {
    return this.cases.detail(parseId(id, ERROR_CODES.TEST_CASE_NOT_FOUND));
  }

  @ProjectRole('developer', 'testCase') @Patch('test-cases/:id')
  updateTestCase(@Param('id') id: string, @Body() dto: UpdateTestCaseDto, @CurrentUser() u: AuthUser) {
    return this.cases.update(parseId(id, ERROR_CODES.TEST_CASE_NOT_FOUND), dto, u);
  }

  @ProjectRole('tester', 'testCase') @Delete('test-cases/:id') @HttpCode(204)
  deleteTestCase(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.cases.remove(parseId(id, ERROR_CODES.TEST_CASE_NOT_FOUND), u);
  }

  @ProjectRole('developer', 'testCase') @Post('test-cases/:id/move') @HttpCode(200)
  moveTestCase(@Param('id') id: string, @Body() dto: MoveTestCaseDto, @CurrentUser() u: AuthUser) {
    return this.cases.move(parseId(id, ERROR_CODES.TEST_CASE_NOT_FOUND), dto, u);
  }

  @ProjectRole('developer', 'testCase') @Post('test-cases/:id/bugs')
  linkTestCaseBug(@Param('id') id: string, @Body() dto: LinkBugDto, @CurrentUser() u: AuthUser, @CurrentProject() p: ProjectContext) {
    return this.cases.linkBug(parseId(id, ERROR_CODES.TEST_CASE_NOT_FOUND), dto, u, p);
  }

  @ProjectRole('developer', 'testCase') @Delete('test-cases/:id/bugs') @HttpCode(204)
  unlinkTestCaseBug(@Param('id') id: string, @Query('issueKey') issueKey: string) {
    return this.cases.unlinkBug(parseId(id, ERROR_CODES.TEST_CASE_NOT_FOUND), issueKey);
  }

  // ----- Import / Export Excel (chạy nền) -----
  @ProjectRole('developer') @Post('projects/:projectKey/test-cases/import') @HttpCode(202)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }))
  async importTestCases(@CurrentProject() p: ProjectContext, @UploadedFile() file: Express.Multer.File, @CurrentUser() u: AuthUser) {
    if (!file) throw badRequest(ERROR_CODES.IMPORT_INVALID, 'Thiếu file Excel (field "file")');
    const objectKey = `${p.key}/imports/${randomUUID()}.xlsx`;
    await this.storage.putObject(objectKey, file.buffer, file.mimetype);
    const jobId = await this.excel.enqueueImport(p.id, u.id, objectKey, 'preview');
    return { jobId, step: 'preview' };
  }

  /** Sau khi xem trước (GET /jobs/:id) thì xác nhận để ghi dữ liệu. */
  @ProjectRole('developer') @Post('projects/:projectKey/test-cases/import/commit') @HttpCode(202)
  async commitImport(@CurrentProject() p: ProjectContext, @Body() dto: CommitImportDto, @CurrentUser() u: AuthUser) {
    const job = await this.queue.getJob(dto.previewJobId);
    if (!job || job.data?.projectId !== p.id.toString() || job.data?.mode !== 'preview' || job.state !== 'completed') {
      throw notFound(ERROR_CODES.JOB_NOT_FOUND, 'Không tìm thấy bước xem trước hợp lệ');
    }
    const jobId = await this.excel.enqueueImport(p.id, u.id, job.data.objectKey, 'commit');
    return { jobId, step: 'commit' };
  }

  @ProjectRole('viewer') @Post('projects/:projectKey/test-cases/export') @HttpCode(202)
  async exportTestCases(@CurrentProject() p: ProjectContext, @Query('functionId') functionId: string | undefined, @CurrentUser() u: AuthUser) {
    const jobId = await this.excel.enqueueExport(p.id, u.id, functionId);
    return { jobId };
  }
}
