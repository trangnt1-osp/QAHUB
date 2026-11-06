import { Body, Controller, Get, HttpCode, Injectable, Param, ParseUUIDPipe, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { ApiKeyGuard, ApiKeyPrincipal, RequireScope } from '../api-keys/api-key.guard';
import { parseId } from '../common/bigint';
import { ApiKeyAuth } from '../common/decorators';
import { AppException } from '../common/errors';
import { IngestRunDto } from './ingest.dto';
import { IngestService } from './ingest.service';
import { ERROR_CODES } from '@ospm/shared';
import { IngestBugsDto } from './ingest-bugs.dto';
import { IngestBugsService } from './ingest-bugs.service';

/** Giới hạn 60 request/phút cho mỗi API key (tracker = id của key). */
@Injectable()
export class ApiKeyThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return req.apiKey?.id ?? req.ip;
  }
  protected async throwThrottlingException(): Promise<void> {
    throw new AppException(429, ERROR_CODES.RATE_LIMITED, 'Vượt giới hạn 60 request/phút cho mỗi API key');
  }
}

@ApiTags('ingest')
@ApiBearerAuth()
@ApiKeyAuth()
@UseGuards(ApiKeyGuard, ApiKeyThrottlerGuard)
@Throttle({ default: { ttl: 60_000, limit: 60 } })
@Controller('ingest')
export class IngestController {
  constructor(private readonly ingest: IngestService, private readonly bugs: IngestBugsService) {}

  /** Nhận trực tiếp 1–100 Bug đã được QC xác nhận; không cần gửi Playwright run hoặc phân tích AI. */
  @RequireScope('issues:write') @Post('bugs') @HttpCode(200)
  ingestSubmitBugs(@Req() req: any, @Body() dto: IngestBugsDto) {
    return this.bugs.submit(req.apiKey, dto);
  }

  @RequireScope('issues:write') @Post('bug-attachments/:attachmentId/complete') @HttpCode(200)
  ingestCompleteBugAttachment(@Req() req: any, @Param('attachmentId', ParseUUIDPipe) attachmentId: string) {
    return this.bugs.completeAttachment(req.apiKey, attachmentId);
  }

  /** Kiểm tra cấu hình API key trong CI. */
  @Get('ping')
  ingestPing(@Req() req: any) {
    return this.ingest.ping(req.apiKey);
  }

  /** Bước 1: mở lần chạy, gửi kết quả; trả presigned URL để upload file. Cùng externalId trả lại run cũ (200). */
  @RequireScope('runs:write') @Post('runs')
  async ingestCreateRun(@Req() req: any, @Body() dto: IngestRunDto, @Res({ passthrough: true }) res: Response) {
    const r = await this.ingest.createRun(req.apiKey as ApiKeyPrincipal, dto);
    res.status(r.http);
    return r.body;
  }

  /** Bước 3: báo hoàn tất, đẩy job xử lý nền. Gọi lại an toàn. */
  @RequireScope('runs:write') @Post('runs/:runId/complete') @HttpCode(202)
  ingestCompleteRun(@Req() req: any, @Param('runId') runId: string) {
    return this.ingest.complete(req.apiKey, parseId(runId, ERROR_CODES.RUN_NOT_FOUND));
  }

  @RequireScope('runs:write') @Get('runs/:runId')
  ingestGetRun(@Req() req: any, @Param('runId') runId: string) {
    return this.ingest.summary(req.apiKey, parseId(runId, ERROR_CODES.RUN_NOT_FOUND));
  }
}
