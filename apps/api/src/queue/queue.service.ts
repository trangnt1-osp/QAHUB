import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import PgBoss from 'pg-boss';
import { env } from '../common/config';

export const JOBS = {
  PROJECT_IMPORT_PREVIEW: 'project-import.preview',
  PROJECT_IMPORT_COMMIT: 'project-import.commit',
  PROCESS_RUN: 'automation.process-run',
  TEST_CASES_BULK: 'testcases.bulk',
  TEST_CASES_IMPORT: 'testcases.import',
  TEST_CASES_EXPORT: 'testcases.export',
  CLEANUP: 'maintenance.cleanup',
} as const;
export type JobName = (typeof JOBS)[keyof typeof JOBS];

export const JOB_RETRY_LIMIT = 3;

export type JobHandler = (data: any, ctx: { isLastAttempt: boolean }) => Promise<unknown>;

/**
 * Hàng đợi pg-boss. QUEUE_MODE=inline (dùng khi test) chạy handler ngay trong tiến trình và chờ xong.
 * Tiến trình API chỉ gửi job; tiến trình Worker (worker.ts) đăng ký handler.
 */
@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private boss?: PgBoss;
  private starting?: Promise<PgBoss>;
  private readonly inlineHandlers = new Map<string, JobHandler>();
  private readonly inlineJobs = new Map<string, { name: string; data: any; state: string; output?: unknown; error?: string }>();

  get inline() {
    return process.env.QUEUE_MODE === 'inline';
  }

  registerInline(name: string, handler: JobHandler) {
    this.inlineHandlers.set(name, handler);
  }

  private async getBoss(opts: { worker?: boolean } = {}): Promise<PgBoss> {
    if (!this.starting) {
      this.starting = (async () => {
        const boss = new PgBoss({ connectionString: env.databaseUrl, schema: 'pgboss', ...(opts.worker ? {} : { supervise: false, schedule: false }) });
        boss.on('error', (e) => this.logger.error(e));
        await boss.start();
        this.boss = boss;
        return boss;
      })();
    }
    return this.starting;
  }

  async send(name: JobName, data: object, opts: { singletonKey?: string } = {}) {
    if (this.inline) {
      const h = this.inlineHandlers.get(name);
      if (!h) throw new Error(`Chưa đăng ký handler inline cho ${name}`);
      const id = `inline-${this.inlineJobs.size + 1}`;
      const job = { name, data, state: 'active' } as { name: string; data: any; state: string; output?: unknown; error?: string };
      this.inlineJobs.set(id, job);
      let lastErr: unknown;
      for (let attempt = 1; attempt <= JOB_RETRY_LIMIT; attempt++) {
        try {
          job.output = await h(data, { isLastAttempt: attempt === JOB_RETRY_LIMIT });
          job.state = 'completed';
          return id;
        } catch (e) {
          lastErr = e;
          if ((e as any)?.noRetry) break;
        }
      }
      job.state = 'failed';
      job.error = (lastErr as Error)?.message;
      this.logger.error(`Job ${name} lỗi sau ${JOB_RETRY_LIMIT} lần: ${job.error}`);
      return id;
    }
    const boss = await this.getBoss();
    return boss.send(name, data, { retryLimit: JOB_RETRY_LIMIT, retryDelay: 10, retryBackoff: true, ...(opts.singletonKey ? { singletonKey: opts.singletonKey } : {}) });
  }

  /** Dùng ở worker.ts */
  async work(name: JobName, handler: JobHandler) {
    const boss = await this.getBoss({ worker: true });
    await boss.work(name, { teamSize: 2, teamConcurrency: 2 }, async (job: any) => {
      const j = Array.isArray(job) ? job[0] : job;
      const full: any = await boss.getJobById(j.id).catch(() => null);
      const retrycount = full?.retrycount ?? 0;
      return (await handler(j.data, { isLastAttempt: retrycount >= JOB_RETRY_LIMIT })) ?? {};
    });
  }

  /** Trạng thái job: created | active | completed | failed (cho import/export/bulk nền). */
  async getJob(id: string): Promise<{ id: string; name: string; data: any; state: string; output?: any; error?: string } | null> {
    if (this.inline) {
      const j = this.inlineJobs.get(id);
      return j ? { id, ...j } : null;
    }
    const boss = await this.getBoss();
    const j: any = await boss.getJobById(id);
    if (!j) return null;
    const state = j.state === 'retry' ? 'active' : j.state;
    return { id, name: j.name, data: j.data, state, output: j.output, error: state === 'failed' ? j.output?.message ?? 'Lỗi' : undefined };
  }

  async schedule(name: JobName, cron: string) {
    const boss = await this.getBoss({ worker: true });
    await boss.schedule(name, cron);
  }

  async onModuleDestroy() {
    if (this.boss) await this.boss.stop({ graceful: false }).catch(() => undefined);
  }
}
