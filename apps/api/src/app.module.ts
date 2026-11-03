import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import { LoggerModule } from 'nestjs-pino';
import { ActivityModule } from './activity/activity.service';
import { AuthModule } from './auth/auth.module';
import { CommonModule } from './common/common.module';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { AttachmentsModule } from './attachments/attachments.module';
import { AutomationModule } from './automation/automation.module';
import { BoardsModule } from './boards/boards.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { IngestModule } from './ingest/ingest.module';
import { IssuesModule } from './issues/issues.module';
import { JobsModule } from './jobs/jobs.module';
import { PrismaModule } from './common/prisma.service';
import { ProjectsModule } from './projects/projects.module';
import { QueueModule } from './queue/queue.module';
import { SprintsModule } from './sprints/sprints.module';
import { SummaryModule } from './summary/summary.module';
import { TestCasesModule } from './test-cases/test-cases.module';
import { UsersModule } from './users/users.module';
import { WorkflowsModule } from './workflows/workflows.module';
import { RolesModule } from './roles/roles.module';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.NODE_ENV === 'test' ? 'silent' : 'info',
        genReqId: (req) => (req.headers['x-request-id'] as string) ?? randomUUID(),
        customProps: (req) => ({ requestId: req.id }),
        redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
      },
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
    PrismaModule,
    CommonModule,
    ActivityModule,
    AuthModule,
    UsersModule,
    RolesModule,
    WorkflowsModule,
    ProjectsModule,
    IssuesModule,
    SprintsModule,
    BoardsModule,
    SummaryModule,
    DashboardModule,
    QueueModule,
    AttachmentsModule,
    ApiKeysModule,
    AutomationModule,
    JobsModule,
    IngestModule,
    TestCasesModule,
  ],
})
export class AppModule {}
