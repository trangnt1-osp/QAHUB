import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, ProjectRole } from '../common/decorators';
import { PresignDto } from './attachments.dto';
import { AttachmentsService } from './attachments.service';

@ApiTags('attachments')
@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  // Vai trò được kiểm tra trong service vì dự án suy ra từ entity ở body
  @Post('presign') @HttpCode(200)
  presignAttachment(@Body() dto: PresignDto, @CurrentUser() u: AuthUser) {
    return this.attachments.presign(dto, u);
  }

  @ProjectRole('developer', 'attachment') @Post(':id/complete') @HttpCode(200)
  completeAttachment(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.attachments.complete(id, user);
  }

  @ProjectRole('viewer', 'attachment') @Get(':id/url')
  getAttachmentUrl(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.attachments.url(id, user);
  }
}
