import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ERROR_CODES } from '@ospm/shared';
import { StorageService } from '../attachments/storage.service';
import { AuthUser, CurrentUser } from '../common/decorators';
import { forbidden, notFound } from '../common/errors';
import { ProjectContextService } from '../common/project-context.service';
import { JOBS, QueueService } from '../queue/queue.service';

@ApiTags('jobs')
@Controller('jobs')
export class JobsController {
  constructor(private readonly queue: QueueService, private readonly storage: StorageService, private readonly projectCtx: ProjectContextService) {}

  /** Trạng thái job nền (import/export/bulk). Export xong thì có `downloadUrl`. */
  @Get(':jobId')
  async getJob(@Param('jobId') jobId: string, @CurrentUser() u: AuthUser) {
    const job = await this.queue.getJob(jobId);
    if (!job) throw notFound(ERROR_CODES.JOB_NOT_FOUND, 'Không tìm thấy job');
    if (u.systemRole !== 'admin' && job.data?.userId !== u.id.toString()) throw forbidden();
    if (job.data?.projectId && [JOBS.TEST_CASES_EXPORT, JOBS.TEST_CASES_IMPORT, JOBS.TEST_CASES_BULK].includes(job.name as any)) {
      const permission = job.name === JOBS.TEST_CASES_EXPORT ? 'testcase.export' : job.name === JOBS.TEST_CASES_IMPORT ? 'testcase.import' : job.data.set?.deleted ? 'testcase.delete' : 'testcase.edit';
      await this.projectCtx.requirePermission(u, BigInt(job.data.projectId), permission);
    }
    const output = job.output ?? null;
    return {
      id: job.id, name: job.name, state: job.state, error: job.error ?? null, result: output,
      downloadUrl: job.state === 'completed' && output?.objectKey && job.name.endsWith('export') ? await this.storage.presignGet(output.objectKey, output.fileName, 3600) : null,
    };
  }
}
