import { Injectable } from '@nestjs/common';
import { AttachmentKind, ERROR_CODES, MAX_ATTACHMENT_BYTES } from '@ospm/shared';
import { AuthUser } from '../common/decorators';
import { AppException, notFound, unprocessable } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { ProjectContextService } from '../common/project-context.service';
import { PresignDto } from './attachments.dto';
import { StorageService } from './storage.service';

export const kindFromMime = (mime: string): AttachmentKind =>
  mime.startsWith('image/') ? 'screenshot' : mime.startsWith('video/') ? 'video' : 'file';

export const safeName = (n: string) => n.replace(/[^\w.-]+/g, '_').slice(-120) || 'file';

@Injectable()
export class AttachmentsService {
  constructor(private readonly prisma: PrismaService, private readonly storage: StorageService, private readonly projectCtx: ProjectContextService) {}

  /** Xác định dự án chứa entity đính kèm. */
  private async projectOf(entity: string, entityId: bigint): Promise<{ id: bigint; key: string }> {
    let projectId: bigint | undefined;
    if (entity === 'issue') projectId = (await this.prisma.issue.findFirst({ where: { id: entityId, deletedAt: null }, select: { projectId: true } }))?.projectId;
    else if (entity === 'comment') projectId = (await this.prisma.issueComment.findFirst({ where: { id: entityId, deletedAt: null }, select: { issue: { select: { projectId: true } } } }))?.issue.projectId;
    else projectId = (await this.prisma.automationResult.findUnique({ where: { id: entityId }, select: { run: { select: { projectId: true } } } }))?.run.projectId;
    if (!projectId) throw notFound(ERROR_CODES.NOT_FOUND, 'Không tìm thấy đối tượng để đính kèm');
    return this.prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { id: true, key: true } });
  }

  async presign(dto: PresignDto, user: AuthUser) {
    if (dto.size > MAX_ATTACHMENT_BYTES) throw new AppException(413, ERROR_CODES.ATTACHMENT_TOO_LARGE, 'File vượt quá 200 MB');
    const entityId = BigInt(dto.entityId);
    const project = await this.projectOf(dto.entity, entityId);
    await this.projectCtx.requirePermission(user, project.id, 'attachment.create');
    await this.projectCtx.requirePermission(user, project.id, dto.entity === 'automation_result' ? 'report.view' : 'issue.view');
    const id = (await this.prisma.$queryRaw<{ id: string }[]>`SELECT gen_random_uuid()::text AS id`)[0].id;
    const objectKey = `${project.key}/${dto.entity}/${entityId}/${id}-${safeName(dto.fileName)}`;
    await this.prisma.attachment.create({
      data: { id, projectId: project.id, entity: dto.entity, entityId, kind: kindFromMime(dto.mimeType), objectKey, fileName: dto.fileName, mimeType: dto.mimeType, sizeBytes: BigInt(dto.size), uploadedBy: user.id },
    });
    return { id, uploadUrl: await this.storage.presignPut(objectKey, dto.mimeType) };
  }

  async complete(id: string, user: AuthUser) {
    const a = await this.prisma.attachment.findUnique({ where: { id } });
    if (a) await this.projectCtx.requirePermission(user, a.projectId, a.entity === 'automation_result' ? 'report.view' : 'issue.view');
    if (!a) throw notFound(ERROR_CODES.ATTACHMENT_NOT_FOUND, 'Không tìm thấy file');
    const head = await this.storage.head(a.objectKey);
    if (!head) {
      await this.prisma.attachment.update({ where: { id }, data: { status: 'failed' } });
      throw unprocessable(ERROR_CODES.ATTACHMENT_NOT_FOUND, 'File chưa được upload lên kho lưu trữ');
    }
    const updated = await this.prisma.attachment.update({ where: { id }, data: { status: 'ready', sizeBytes: BigInt(head.size) } });
    return { id: updated.id, status: updated.status, sizeBytes: updated.sizeBytes };
  }

  async url(id: string, user: AuthUser) {
    const a = await this.prisma.attachment.findUnique({ where: { id } });
    if (a) await this.projectCtx.requirePermission(user, a.projectId, a.entity === 'automation_result' ? 'report.view' : 'issue.view');
    if (!a || a.status !== 'ready') throw notFound(ERROR_CODES.ATTACHMENT_NOT_FOUND, 'Không tìm thấy file');
    return { url: await this.storage.presignGet(a.objectKey, a.fileName, 3600, a.mimeType), fileName: a.fileName, mimeType: a.mimeType, expiresInSec: 3600 };
  }
}
