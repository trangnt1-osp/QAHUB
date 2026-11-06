import { Module } from '@nestjs/common';
import { ApiKeyThrottlerGuard, IngestController } from './ingest.controller';
import { IngestService } from './ingest.service';
import { IngestBugsService } from './ingest-bugs.service';

@Module({ controllers: [IngestController], providers: [IngestService, IngestBugsService, ApiKeyThrottlerGuard] })
export class IngestModule {}
