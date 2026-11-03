import {
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { ERROR_CODES } from '@ospm/shared';
import { AuthUser, CurrentUser } from '../common/decorators';
import { PrismaService } from '../common/prisma.service';
import { badRequest, notFound } from '../common/errors';
import { StorageService } from '../attachments/storage.service';
import { buildProjectImportTemplate, ImportScope, TemplateKind } from './import-workbook';
import { ProjectImportService } from './project-import.service';

@ApiTags('project-import')
@Controller('projects/:key/imports')
export class ProjectImportController {
  constructor(
    private readonly service: ProjectImportService,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}
  private async project(key: string) {
    const p = await this.prisma.project.findFirst({ where: { key, deletedAt: null } });
    if (!p) throw notFound(ERROR_CODES.PROJECT_NOT_FOUND, 'Project not found');
    return p;
  }
  @Get('template')
  async template(
    @Param('key') key: string,
    @Query('kind') kind: TemplateKind,
    @CurrentUser() user: AuthUser,
    @Res() response: Response,
  ) {
    if (!['module', 'epic', 'function', 'all', 'backlog'].includes(kind))
      throw badRequest(ERROR_CODES.IMPORT_INVALID, 'Invalid template kind');
    const p = await this.project(key);
    await this.service.authorize(user, p.id, kind === 'backlog' ? 'backlog' : 'structure');
    const [statuses, periods] = await Promise.all([
      this.prisma.workflowStatus.findMany({
        where: { projectId: p.id, isArchived: false },
        orderBy: { position: 'asc' },
      }),
      this.prisma.sprint.findMany({
        where: { projectId: p.id, deletedAt: null, state: { not: 'closed' }, kind: p.trackingMode },
      }),
    ]);
    const buffer = await buildProjectImportTemplate(kind, {
      projectKey: key,
      statuses: statuses.map((s) => s.name),
      periods: periods.map((s) => s.name),
    });
    response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.setHeader('Content-Disposition', `attachment; filename="${key}-${kind}-import.xlsx"`);
    response.send(buffer);
  }
  @Post('preview')
  @HttpCode(202)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  async preview(
    @Param('key') key: string,
    @Query('scope') scope: ImportScope,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthUser,
  ) {
    if (!['structure', 'backlog'].includes(scope))
      throw badRequest(ERROR_CODES.IMPORT_INVALID, 'Invalid import scope');
    const p = await this.project(key);
    await this.service.authorize(user, p.id, scope);
    if (!file || !file.originalname.toLowerCase().endsWith('.xlsx'))
      throw badRequest(ERROR_CODES.IMPORT_INVALID, 'Upload an .xlsx workbook using field file');
    const objectKey = `project-imports/${p.id}/${randomUUID()}.xlsx`;
    await this.storage.putObject(objectKey, file.buffer, file.mimetype);
    return { jobId: await this.service.enqueuePreview(p.id, user.id, scope, objectKey, file.originalname) };
  }
  @Post(':sessionId/commit')
  @HttpCode(202)
  async commit(@Param('key') key: string, @Param('sessionId') id: string, @CurrentUser() user: AuthUser) {
    const p = await this.project(key);
    return { jobId: await this.service.enqueueCommit(user, p.id, id) };
  }
}
