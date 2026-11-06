import { HttpException, Injectable, Logger } from '@nestjs/common';
import { ERROR_CODES, MAX_ATTACHMENT_BYTES } from '@ospm/shared';
import { createHash } from 'node:crypto';
import { ActivityService } from '../activity/activity.service';
import { ApiKeyPrincipal } from '../api-keys/api-key.guard';
import { safeName } from '../attachments/attachments.service';
import { StorageService } from '../attachments/storage.service';
import { notFound, unprocessable } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { allocateIssueNumber, doc, issueKeyOf, rankAtEnd, recordStatusChange } from '../issues/issue-core';
import { IngestBugDto, IngestBugsDto } from './ingest-bugs.dto';

@Injectable()
export class IngestBugsService {
  private readonly logger = new Logger(IngestBugsService.name);
  constructor(private readonly prisma: PrismaService, private readonly activity: ActivityService, private readonly storage: StorageService) {}

  async submit(key: ApiKeyPrincipal, dto: IngestBugsDto) {
    const items = [];
    for (const bug of dto.bugs) {
      try {
        items.push(await this.createOne(key, bug));
      } catch (error) {
        const known = error instanceof HttpException;
        if (!known) this.logger.error('Failed to import confirmed Bug', error instanceof Error ? error.stack : undefined);
        const detail = known ? error.getResponse() : null;
        items.push({ externalId: bug.externalId, status: 'failed', error: {
          statusCode: known ? error.getStatus() : 500,
          code: detail && typeof detail === 'object' && 'code' in detail ? detail.code : 'INTERNAL_ERROR',
          message: known ? error.message : 'Không thể tạo Bug lúc này. Hãy gửi lại cùng externalId.',
        } });
      }
    }
    return { projectKey: key.projectKey, created: items.filter((i) => i.status === 'created').length,
      existing: items.filter((i) => i.status === 'existing').length, failed: items.filter((i) => i.status === 'failed').length, items };
  }

  private async createOne(key: ApiKeyPrincipal, bug: IngestBugDto) {
    // Separate namespace from automatic test-failure fingerprints. One ID survives key rotation and soft deletion.
    const fingerprint = `public-bug:${createHash('sha256').update(bug.externalId).digest('hex')}`;
    const result = await this.prisma.$transaction(async (tx) => {
      // Serialize deduplication and ranking across external clients for this project.
      const projects = await tx.$queryRaw<{ id: bigint }[]>`SELECT id FROM projects WHERE id = ${key.projectId} AND deleted_at IS NULL FOR UPDATE`;
      if (!projects.length) throw notFound(ERROR_CODES.PROJECT_NOT_FOUND, 'Không tìm thấy dự án');
      const existing = await tx.issue.findFirst({ where: { projectId: key.projectId, fingerprint } });
      if (existing) return { issue: existing, status: 'existing' as const };

      if (bug.assigneeId) {
        const member = await tx.projectMember.findFirst({ where: { projectId: key.projectId, userId: BigInt(bug.assigneeId), leftAt: null, user: { isActive: true } } });
        if (!member) throw unprocessable(ERROR_CODES.VALIDATION_ERROR, 'Người được gán phải là thành viên đang hoạt động của dự án');
      }
      const settings = await tx.workflowSettings.findUniqueOrThrow({ where: { projectId: key.projectId } });
      const statusId = settings.acceptStatusId ?? settings.initialManualStatusId;
      const status = await tx.workflowStatus.findFirst({ where: { id: statusId, projectId: key.projectId, isArchived: false, category: { notIn: ['triage', 'done'] } } });
      if (!status) throw unprocessable(ERROR_CODES.VALIDATION_ERROR, 'Dự án chưa cấu hình trạng thái tiếp nhận Bug đã xác nhận');
      const auto = await tx.label.findUniqueOrThrow({ where: { projectId_name: { projectId: key.projectId, name: 'auto' } } });
      const number = await allocateIssueNumber(tx, key.projectId);
      const paragraphs = [
        `Bug đã được QC xác nhận trước khi gửi. Mã nguồn: ${bug.externalId}`,
        ...(bug.description ? [bug.description] : []),
        ...(bug.preconditions ? [`Điều kiện tiên quyết: ${bug.preconditions}`] : []),
        'Các bước tái hiện:', ...bug.steps.map((step, i) => `${i + 1}. ${step}`),
        `Kết quả mong đợi: ${bug.expected}`, `Kết quả thực tế: ${bug.actual}`,
        ...(bug.testCaseIds?.length ? [`Testcase liên quan: ${bug.testCaseIds.join(', ')}`] : []),
        ...(bug.environment ? [`Môi trường: ${bug.environment}`] : []),
        ...(bug.branch ? [`Branch: ${bug.branch}`] : []), ...(bug.commitSha ? [`Commit: ${bug.commitSha}`] : []),
      ];
      const issue = await tx.issue.create({ data: {
        projectId: key.projectId, number, type: 'bug', title: bug.title, description: doc(...paragraphs),
        statusId: status.id, priority: bug.priority ?? 'medium', source: 'auto', fingerprint,
        createdByApiKeyId: key.id, assigneeId: bug.assigneeId ? BigInt(bug.assigneeId) : null,
        rank: await rankAtEnd(tx, key.projectId, null), labels: { create: [{ labelId: auto.id }] },
      } });
      await recordStatusChange(tx, issue.id, null, status.id, null);
      for (const attachment of bug.attachments ?? []) {
        await tx.attachment.create({ data: {
          projectId: key.projectId, entity: 'issue', entityId: issue.id, kind: attachment.kind,
          fileName: attachment.fileName, mimeType: attachment.mimeType, sizeBytes: BigInt(attachment.size),
          objectKey: `${key.projectKey}/issue/${issue.id}/${Buffer.from(attachment.ref).toString('base64url')}/${safeName(attachment.fileName)}`,
          uploadedByApiKeyId: key.id,
        } });
      }
      await this.activity.log({ projectId: key.projectId, entity: 'issue', entityId: issueKeyOf(key.projectKey, number),
        action: 'created', actorApiKeyId: key.id, changes: { title: [null, issue.title], source: [null, 'auto'], externalId: [null, bug.externalId], confirmed: [null, true] } }, tx);
      return { issue, status: 'created' as const };
    });
    const { issue, status } = result;
    const pending = issue.deletedAt ? [] : await this.prisma.attachment.findMany({ where: {
      projectId: key.projectId, entity: 'issue', entityId: issue.id, uploadedByApiKeyId: key.id, status: { in: ['pending', 'failed'] },
    } });
    const uploads = await Promise.all(pending.map(async (a) => ({
      ref: Buffer.from(a.objectKey.split('/').at(-2)!, 'base64url').toString('utf8'), attachmentId: a.id,
      uploadUrl: await this.storage.presignPut(a.objectKey, a.mimeType),
    })));
    const issueKey = issueKeyOf(key.projectKey, issue.number);
    return { externalId: bug.externalId, status, issueId: issue.id, issueKey, url: `/browse/${issueKey}`, deleted: !!issue.deletedAt, uploads };
  }

  async completeAttachment(key: ApiKeyPrincipal, id: string) {
    const attachment = await this.prisma.attachment.findFirst({ where: { id, projectId: key.projectId, entity: 'issue', uploadedByApiKeyId: key.id } });
    if (!attachment || !await this.prisma.issue.findFirst({ where: { id: attachment.entityId, projectId: key.projectId, deletedAt: null } })) {
      throw notFound(ERROR_CODES.ATTACHMENT_NOT_FOUND, 'Không tìm thấy file');
    }
    if (attachment.status === 'ready') return { id, status: 'ready' };
    const head = await this.storage.head(attachment.objectKey);
    if (!head) throw unprocessable(ERROR_CODES.ATTACHMENT_NOT_FOUND, 'File chưa được upload');
    if (head.size > MAX_ATTACHMENT_BYTES || BigInt(head.size) !== attachment.sizeBytes) {
      throw unprocessable(ERROR_CODES.VALIDATION_ERROR, 'Kích thước file không khớp thông tin đã khai báo');
    }
    await this.prisma.attachment.update({ where: { id }, data: { status: 'ready' } });
    return { id, status: 'ready' };
  }
}
