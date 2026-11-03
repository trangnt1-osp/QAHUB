import { Global, Module } from '@nestjs/common';
import { ProjectImportController } from './project-import.controller';
import { ProjectImportService } from './project-import.service';
@Global()
@Module({
  controllers: [ProjectImportController],
  providers: [ProjectImportService],
  exports: [ProjectImportService],
})
export class ProjectImportModule {}
